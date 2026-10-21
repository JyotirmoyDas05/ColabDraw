import {
  compressData,
  decompressData,
} from "@excalidraw/excalidraw/data/encode";
import { generateEncryptionKey } from "@excalidraw/excalidraw/data/encryption";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { isInvisiblySmallElement } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";
import { bytesToHexString } from "@excalidraw/common";

import type { UserIdleState } from "@excalidraw/common";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { SceneBounds } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type { MakeBrand } from "@excalidraw/common/utility-types";

import {
  DELETED_ELEMENT_TIMEOUT,
  FILE_UPLOAD_MAX_BYTES,
  ROOM_ID_BYTES,
} from "../app_constants";

import { encodeFilesForUpload } from "./FileManager";
import {
  BACKEND_URL,
  bytesToBase64,
  createShareLink,
  readShareLink,
  saveFilesToBackend,
} from "./backend";

import type { WS_SUBTYPES } from "../app_constants";

export type SyncableExcalidrawElement = OrderedExcalidrawElement &
  MakeBrand<"SyncableExcalidrawElement">;

export const isSyncableElement = (
  element: OrderedExcalidrawElement,
): element is SyncableExcalidrawElement => {
  if (element.isDeleted) {
    if (element.updated > Date.now() - DELETED_ELEMENT_TIMEOUT) {
      return true;
    }
    return false;
  }
  return !isInvisiblySmallElement(element);
};

export const getSyncableElements = (
  elements: readonly OrderedExcalidrawElement[],
) =>
  elements.filter((element) =>
    isSyncableElement(element),
  ) as SyncableExcalidrawElement[];

// Collaboration links carry the room key in the URL hash; nothing is shared here.

const generateRoomId = async () => {
  const buffer = new Uint8Array(ROOM_ID_BYTES);
  window.crypto.getRandomValues(buffer);
  return bytesToHexString(buffer);
};

export type EncryptedData = {
  data: ArrayBuffer;
  iv: Uint8Array;
};

export type SocketUpdateDataSource = {
  INVALID_RESPONSE: {
    type: WS_SUBTYPES.INVALID_RESPONSE;
  };
  SCENE_INIT: {
    type: WS_SUBTYPES.INIT;
    payload: {
      elements: readonly OrderedExcalidrawElement[];
    };
  };
  SCENE_UPDATE: {
    type: WS_SUBTYPES.UPDATE;
    payload: {
      elements: readonly OrderedExcalidrawElement[];
    };
  };
  MOUSE_LOCATION: {
    type: WS_SUBTYPES.MOUSE_LOCATION;
    payload: {
      socketId: SocketId;
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
      selectedElementIds: AppState["selectedElementIds"];
      username: string;
    };
  };
  USER_VISIBLE_SCENE_BOUNDS: {
    type: WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS;
    payload: {
      socketId: SocketId;
      username: string;
      sceneBounds: SceneBounds;
    };
  };
  IDLE_STATUS: {
    type: WS_SUBTYPES.IDLE_STATUS;
    payload: {
      socketId: SocketId;
      userState: UserIdleState;
      username: string;
    };
  };
};

export type SocketUpdateDataIncoming =
  SocketUpdateDataSource[keyof SocketUpdateDataSource];

export type SocketUpdateData =
  SocketUpdateDataSource[keyof SocketUpdateDataSource] & {
    _brand: "socketUpdateData";
  };

// `,view` marks a read-only link. Older links have no suffix and stay editable.
const RE_COLLAB_LINK = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)(,view)?$/;

export const isCollaborationLink = (link: string) => {
  const hash = new URL(link).hash;
  return RE_COLLAB_LINK.test(hash);
};

export const getCollaborationLinkData = (link: string) => {
  const hash = new URL(link).hash;
  const match = hash.match(RE_COLLAB_LINK);
  if (match && match[2].length !== 22) {
    window.alert(t("alerts.invalidEncryptionKey"));
    return null;
  }
  return match
    ? {
        roomId: match[1],
        roomKey: match[2],
        isViewOnly: !!match[3],
      }
    : null;
};

export const generateCollaborationLinkData = async () => {
  const roomId = await generateRoomId();
  const roomKey = await generateEncryptionKey();

  if (!roomKey) {
    throw new Error("Couldn't generate room key");
  }

  return { roomId, roomKey };
};

export const getCollaborationLink = (data: {
  roomId: string;
  roomKey: string;
  viewOnly?: boolean;
}) => {
  return `${window.location.origin}${window.location.pathname}#room=${
    data.roomId
  },${data.roomKey}${data.viewOnly ? ",view" : ""}`;
};

/** the view-only variant of an existing collaboration link */
export const getViewOnlyCollaborationLink = (link: string) => {
  return `${link.replace(/,view$/, "")},view`;
};

// legacy_decodeFromBackend removed; new shares live in our own backend.

export const importFromBackend = async (
  id: string,
  decryptionKey: string,
): Promise<ImportedDataState> => {
  try {
    // Fetch from our own backend instead of Excalidraw's public API
    const doc = await readShareLink(id);

    if (!doc) {
      window.alert(t("alerts.importBackendFailed"));
      return {};
    }

    const buffer = Uint8Array.from(atob(doc.ciphertext), (c) =>
      c.charCodeAt(0),
    );

    try {
      const { data: decodedBuffer } = await decompressData(
        new Uint8Array(buffer),
        {
          decryptionKey,
        },
      );
      const data: ImportedDataState = JSON.parse(
        new TextDecoder().decode(decodedBuffer),
      );

      return {
        elements: data.elements || null,
        appState: data.appState || null,
      };
    } catch (error: any) {
      console.warn("error when decoding shareLink data:", error);
      return {};
    }
  } catch (error: any) {
    window.alert(t("alerts.importBackendFailed"));
    console.error(error);
    return {};
  }
};

type ExportToBackendResult =
  | { url: null; errorMessage: string }
  | { url: string; errorMessage: null };

/**
 * Turns the backend's error into something a user (or the person running the
 * deployment) can act on, instead of a generic failure.
 */
export const describeShareLinkError = (error: any) => {
  const message = String(error?.message || "");

  if (error?.status === 413 || /longer than.*?bytes/i.test(message)) {
    return t("alerts.couldNotCreateShareableLinkTooBig");
  }
  return t("alerts.couldNotCreateShareableLink");
};

export const exportToBackend = async (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<ExportToBackendResult> => {
  if (!BACKEND_URL) {
    return {
      url: null,
      errorMessage: t("alerts.shareLinkNotConfigured"),
    };
  }

  const encryptionKey = await generateEncryptionKey("string");

  const payload = await compressData(
    new TextEncoder().encode(
      serializeAsJSON(elements, appState, files, "database"),
    ),
    { encryptionKey },
  );

  try {
    const filesMap = new Map<FileId, BinaryFileData>();
    for (const element of elements) {
      if (isInitializedImageElement(element) && files[element.fileId]) {
        filesMap.set(element.fileId, files[element.fileId]);
      }
    }

    const filesToUpload = await encodeFilesForUpload({
      files: filesMap,
      encryptionKey,
      maxBytes: FILE_UPLOAD_MAX_BYTES,
    });

    const id = await generateRoomId();

    // Save encrypted JSON to the backend
    const ciphertextBase64 = bytesToBase64(new Uint8Array(payload.buffer));

    await createShareLink(id, ciphertextBase64);

    const url = new URL(window.location.href);
    url.hash = `json=${id},${encryptionKey}`;
    const urlString = url.toString();

    await saveFilesToBackend({ files: filesToUpload, ownerId: id });

    return { url: urlString, errorMessage: null };
  } catch (error: any) {
    console.error(error);

    return { url: null, errorMessage: describeShareLinkError(error) };
  }
};

// Re-export backend functions for easy importing
export { loadFilesFromBackend, saveFilesToBackend } from "./backend";
