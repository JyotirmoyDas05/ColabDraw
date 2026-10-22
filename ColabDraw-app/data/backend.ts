import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { CollabSocket } from "../collab/CollabSocket";

// Backend configuration
// -----------------------------------------------------------------------------

export const BACKEND_URL = (
  import.meta.env.VITE_APP_BACKEND_URL ||
  "https://colabdraw-backend.jyotimoydas.workers.dev"
).replace(/\/+$/, "");

/**
 * Carries the HTTP status so callers can distinguish "too big" from "the
 * network is down" without parsing a message.
 */
export class BackendError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BackendError";
  }
}

const url = (path: string) => `${BACKEND_URL}${path}`;

const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(url(path), init);

  if (!response.ok) {
    throw new BackendError(
      response.status,
      `${init?.method ?? "GET"} ${path} failed with ${response.status}`,
    );
  }

  return response;
};

export type StoredScene = {
  roomId: string;
  sceneVersion: number;
  iv: string; // Base64 encoded
  ciphertext: string; // Base64 encoded
};

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: StoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  // Decode base64 strings back to Uint8Array
  const ciphertext = Uint8Array.from(atob(data.ciphertext), (c) =>
    c.charCodeAt(0),
  );
  const iv = Uint8Array.from(atob(data.iv), (c) => c.charCodeAt(0));

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

/** `null` means the room has never been saved; every other failure throws. */
const getStoredScene = async (roomId: string): Promise<StoredScene | null> => {
  const response = await fetch(url(`/scenes/${roomId}`));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new BackendError(
      response.status,
      `GET /scenes/${roomId} failed with ${response.status}`,
    );
  }

  return response.json();
};

class SceneVersionCache {
  private static cache = new WeakMap<CollabSocket, number>();
  static get = (socket: CollabSocket) => {
    return SceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: CollabSocket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    SceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToBackend = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return SceneVersionCache.get(portal.socket) === sceneVersion;
  }
  return true;
};

/**
 * Files are stored under the id of the thing that encrypted them.
 * A scene file uses the roomId; a share-link file uses the share-link id.
 */
const fileKey = (ownerId: string, fileId: FileId) => `${ownerId}_${fileId}`;

export const bytesToBase64 = (bytes: Uint8Array) => {
  // spreading a large array into String.fromCharCode overflows the call stack,
  // which is why this goes in chunks
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const saveFilesToBackend = async ({
  ownerId,
  files,
}: {
  ownerId: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const savedFiles = new Map<FileId, true>();
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const bodyBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer;

        await request(`/files/${fileKey(ownerId, id)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: bodyBuffer,
        });
        savedFiles.set(id, true);
      } catch (error: any) {
        erroredFiles.set(id, true);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

const createSceneDocument = async (
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
  roomId: string,
): Promise<StoredScene> => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);

  const ciphertextBase64 = bytesToBase64(new Uint8Array(ciphertext));
  const ivBase64 = bytesToBase64(iv);

  return {
    roomId,
    sceneVersion,
    ciphertext: ciphertextBase64,
    iv: ivBase64,
  };
};

/**
 * Reads what is stored, merges it with what is on screen, and writes the result
 * back. The write is an upsert, so there is no create/update branch.
 */
export const saveToBackend = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (!roomId || !roomKey || !socket || isSavedToBackend(portal, elements)) {
    return null;
  }

  const previous = await getStoredScene(roomId);

  const elementsToStore = previous
    ? getSyncableElements(
        reconcileElements(
          elements,
          getSyncableElements(
            restoreElements(await decryptElements(previous, roomKey), null),
          ) as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
          appState,
        ),
      )
    : elements;

  const storedScene = await createSceneDocument(
    elementsToStore,
    roomKey,
    roomId,
  );

  await request(`/scenes/${roomId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(storedScene),
  });

  const storedElements = getSyncableElements(
    restoreElements(await decryptElements(storedScene, roomKey), null),
  );

  SceneVersionCache.set(socket, storedElements);

  return toBrandedType<RemoteExcalidrawElement[]>(storedElements);
};

export const loadFromBackend = async (
  roomId: string,
  roomKey: string,
  socket: CollabSocket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const storedScene = await getStoredScene(roomId);

  if (!storedScene) {
    return null;
  }

  const elements = getSyncableElements(
    restoreElements(await decryptElements(storedScene, roomKey), null, {
      deleteInvisibleElements: true,
    }),
  );

  if (socket) {
    SceneVersionCache.set(socket, elements);
  }

  return elements;
};

export const loadFilesFromBackend = async (
  decryptionKey: string,
  filesIds: readonly FileId[],
  /** room id or share-link id — the owner of the key these bytes were encrypted with */
  ownerId: string,
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const response = await fetch(url(`/files/${fileKey(ownerId, id)}`));

        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

          const dataURL = new TextDecoder("utf-8").decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

export const readShareLink = async (
  id: string,
): Promise<{ ciphertext: string } | null> => {
  const response = await fetch(url(`/share-links/${id}`));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new BackendError(
      response.status,
      `GET /share-links/${id} failed with ${response.status}`,
    );
  }

  return response.json();
};

export const createShareLink = async (id: string, ciphertext: string) => {
  await request(`/share-links/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ciphertext }),
  });
};
