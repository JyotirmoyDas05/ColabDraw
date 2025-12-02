import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";
import { Client, Databases, Storage } from "appwrite";

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
import type { Socket } from "socket.io-client";

// Appwrite Configuration
// -----------------------------------------------------------------------------

const APPWRITE_ENDPOINT = import.meta.env.VITE_APP_APPWRITE_ENDPOINT;
const APPWRITE_PROJECT_ID = import.meta.env.VITE_APP_APPWRITE_PROJECT_ID;
const APPWRITE_DATABASE_ID = import.meta.env.VITE_APP_APPWRITE_DATABASE_ID;
const APPWRITE_TABLE_ID = import.meta.env.VITE_APP_APPWRITE_TABLE_ID;
const APPWRITE_BUCKET_ID = import.meta.env.VITE_APP_APPWRITE_BUCKET_ID;

let appwriteClient: Client | null = null;
let appwriteDatabase: Databases | null = null;
let appwriteStorage: Storage | null = null;

const _initializeAppwrite = () => {
  if (!appwriteClient) {
    appwriteClient = new Client()
      .setEndpoint(APPWRITE_ENDPOINT)
      .setProject(APPWRITE_PROJECT_ID);
  }
  return appwriteClient;
};

const _getDatabase = () => {
  if (!appwriteDatabase) {
    appwriteDatabase = new Databases(_initializeAppwrite());
  }
  return appwriteDatabase;
};

const _getStorage = () => {
  if (!appwriteStorage) {
    appwriteStorage = new Storage(_initializeAppwrite());
  }
  return appwriteStorage;
};

// -----------------------------------------------------------------------------

export const loadAppwriteStorage = async () => {
  return _getStorage();
};

type AppwriteStoredScene = {
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
  data: AppwriteStoredScene,
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

class AppwriteSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return AppwriteSceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    AppwriteSceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToAppwrite = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return AppwriteSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  return true;
};

export const saveFilesToAppwrite = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const storage = await loadAppwriteStorage();

  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        // Create a File object from the buffer
        // Use slice with type assertion to ensure we get a standard ArrayBuffer
        const arrayBuffer = buffer.buffer.slice(0) as ArrayBuffer;
        const blob = new Blob([arrayBuffer], {
          type: "application/octet-stream",
        });
        const file = new File([blob], id, { type: "application/octet-stream" });

        await storage.createFile(APPWRITE_BUCKET_ID, id, file);
        savedFiles.push(id);
      } catch (error: any) {
        // If file already exists, consider it saved
        if (error.code === 409) {
          savedFiles.push(id);
        } else {
          console.error(`Failed to upload file ${id}:`, error);
          erroredFiles.push(id);
        }
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

const createAppwriteSceneDocument = async (
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
  roomId: string,
): Promise<AppwriteStoredScene> => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);

  // Convert to base64 for string storage
  const ciphertextBase64 = btoa(
    String.fromCharCode(...new Uint8Array(ciphertext)),
  );
  const ivBase64 = btoa(String.fromCharCode(...iv));

  return {
    roomId,
    sceneVersion,
    ciphertext: ciphertextBase64,
    iv: ivBase64,
  };
};

export const saveToAppwrite = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (!roomId || !roomKey || !socket || isSavedToAppwrite(portal, elements)) {
    return null;
  }

  const database = _getDatabase();

  try {
    // Try to get existing document
    const existingDoc = await database.getDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_TABLE_ID,
      roomId,
    );

    // Document exists, update it
    const prevStoredScene = existingDoc as unknown as AppwriteStoredScene;
    const prevStoredElements = getSyncableElements(
      restoreElements(await decryptElements(prevStoredScene, roomKey), null),
    );
    const reconciledElements = getSyncableElements(
      reconcileElements(
        elements,
        prevStoredElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
        appState,
      ),
    );

    const storedScene = await createAppwriteSceneDocument(
      reconciledElements,
      roomKey,
      roomId,
    );

    await database.updateDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_TABLE_ID,
      roomId,
      storedScene,
    );

    const storedElements = getSyncableElements(
      restoreElements(await decryptElements(storedScene, roomKey), null),
    );

    AppwriteSceneVersionCache.set(socket, storedElements);

    return storedElements;
  } catch (error: any) {
    // Document doesn't exist, create it
    if (error.code === 404) {
      const storedScene = await createAppwriteSceneDocument(
        elements,
        roomKey,
        roomId,
      );

      await database.createDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_TABLE_ID,
        roomId,
        storedScene,
      );

      const storedElements = getSyncableElements(
        restoreElements(await decryptElements(storedScene, roomKey), null),
      );

      AppwriteSceneVersionCache.set(socket, storedElements);

      return storedElements;
    }

    throw error;
  }
};

export const loadFromAppwrite = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const database = _getDatabase();

  try {
    const docSnap = await database.getDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_TABLE_ID,
      roomId,
    );

    if (!docSnap) {
      return null;
    }

    const storedScene = docSnap as unknown as AppwriteStoredScene;
    const elements = getSyncableElements(
      restoreElements(await decryptElements(storedScene, roomKey), null, {
        deleteInvisibleElements: true,
      }),
    );

    if (socket) {
      AppwriteSceneVersionCache.set(socket, elements);
    }

    return elements;
  } catch (error: any) {
    if (error.code === 404) {
      return null;
    }
    throw error;
  }
};

export const loadFilesFromAppwrite = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const storage = _getStorage();
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        // Get file download URL
        const downloadUrl = storage.getFileDownload(APPWRITE_BUCKET_ID, id);

        const response = await fetch(downloadUrl.toString());
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

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
