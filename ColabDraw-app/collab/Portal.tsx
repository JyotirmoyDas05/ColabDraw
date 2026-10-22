import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import { encryptData } from "@excalidraw/excalidraw/data/encryption";
import throttle from "lodash.throttle";

import type { UserIdleState } from "@excalidraw/common";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type {
  OnUserFollowedPayload,
  SocketId,
} from "@excalidraw/excalidraw/types";

import { FILE_UPLOAD_TIMEOUT, WS_SUBTYPES } from "../app_constants";
import { isSyncableElement } from "../data";

import type { PresentationSettings } from "../presentation/presentationState";

import type {
  SocketUpdateData,
  SocketUpdateDataSource,
  SyncableExcalidrawElement,
} from "../data";
import type { TCollabClass } from "./Collab";
import type { CollabSocket } from "./CollabSocket";

class Portal {
  collab: TCollabClass;
  socket: CollabSocket | null = null;
  socketInitialized: boolean = false; // we don't want the socket to emit any updates until it is fully initialized
  roomId: string | null = null;
  roomKey: string | null = null;
  isViewOnly: boolean = false;
  broadcastedElementVersions: Map<string, number> = new Map();

  constructor(collab: TCollabClass) {
    this.collab = collab;
  }

  open(
    socket: CollabSocket,
    id: string,
    key: string,
    isViewOnly = false,
  ): CollabSocket {
    this.socket = socket;
    this.roomId = id;
    this.roomKey = key;
    this.isViewOnly = isViewOnly;

    this.socket.on("newUser", async (_socketId: string) => {
      this.broadcastScene(
        WS_SUBTYPES.INIT,
        this.collab.getSceneElementsIncludingDeleted(),
        /* syncAll */ true,
      );
    });
    this.socket.on("members", (clients: string[]) => {
      this.collab.setCollaborators(clients as SocketId[]);
    });

    this.socket.connect();

    return socket;
  }

  close() {
    if (!this.socket) {
      return;
    }
    this.queueFileUpload.flush();
    this.socket.close();
    this.socket = null;
    this.roomId = null;
    this.roomKey = null;
    this.isViewOnly = false;
    this.socketInitialized = false;
    this.broadcastedElementVersions = new Map();
  }

  isOpen() {
    return !!(
      this.socketInitialized &&
      this.socket &&
      this.roomId &&
      this.roomKey
    );
  }

  async _broadcastSocketData(
    data: SocketUpdateData,
    volatile: boolean = false,
    followersOnly: boolean = false,
    allowViewers: boolean = false,
  ) {
    // viewers are read-only: never send scene updates, cursors or presence
    if (this.isViewOnly) {
      return;
    }
    if (this.isOpen()) {
      const json = JSON.stringify(data);
      const encoded = new TextEncoder().encode(json);
      const { encryptedBuffer, iv } = await encryptData(this.roomKey!, encoded);

      this.socket?.sendUpdate(encryptedBuffer, iv, {
        volatile,
        followersOnly,
      });
    }
  }

  queueFileUpload = throttle(async () => {
    try {
      await this.collab.fileManager.saveFiles({
        elements: this.collab.excalidrawAPI.getSceneElementsIncludingDeleted(),
        files: this.collab.excalidrawAPI.getFiles(),
      });
    } catch (error: any) {
      if (error.name !== "AbortError") {
        this.collab.excalidrawAPI.updateScene({
          appState: {
            errorMessage: error.message,
          },
        });
      }
    }

    let isChanged = false;
    const newElements = this.collab.excalidrawAPI
      .getSceneElementsIncludingDeleted()
      .map((element) => {
        if (this.collab.fileManager.shouldUpdateImageElementStatus(element)) {
          isChanged = true;
          // this will signal collaborators to pull image data from server
          // (using mutation instead of newElementWith otherwise it'd break
          // in-progress dragging)
          return newElementWith(element, { status: "saved" });
        }
        return element;
      });

    if (isChanged) {
      this.collab.excalidrawAPI.updateScene({
        elements: newElements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }, FILE_UPLOAD_TIMEOUT);

  broadcastScene = async (
    updateType: WS_SUBTYPES.INIT | WS_SUBTYPES.UPDATE,
    elements: readonly OrderedExcalidrawElement[],
    syncAll: boolean,
  ) => {
    if (updateType === WS_SUBTYPES.INIT && !syncAll) {
      throw new Error("syncAll must be true when sending SCENE.INIT");
    }

    // sync out only the elements we think we need to to save bandwidth.
    // periodically we'll resync the whole thing to make sure no one diverges
    // due to a dropped message (server goes down etc).
    const syncableElements = elements.reduce((acc, element) => {
      if (
        (syncAll ||
          !this.broadcastedElementVersions.has(element.id) ||
          element.version > this.broadcastedElementVersions.get(element.id)!) &&
        isSyncableElement(element)
      ) {
        acc.push(element);
      }
      return acc;
    }, [] as SyncableExcalidrawElement[]);

    const data: SocketUpdateDataSource[typeof updateType] = {
      type: updateType,
      payload: {
        elements: syncableElements,
      },
    };

    for (const syncableElement of syncableElements) {
      this.broadcastedElementVersions.set(
        syncableElement.id,
        syncableElement.version,
      );
    }

    this.queueFileUpload();

    await this._broadcastSocketData(data as SocketUpdateData, false, false);
  };

  broadcastIdleChange = (userState: UserIdleState) => {
    if (this.socket?.id) {
      const data: SocketUpdateDataSource["IDLE_STATUS"] = {
        type: WS_SUBTYPES.IDLE_STATUS,
        payload: {
          socketId: this.socket.id as SocketId,
          userState,
          username: this.collab.state.username,
        },
      };
      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
      );
    }
  };

  broadcastMouseLocation = (payload: {
    pointer: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["pointer"];
    button: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["button"];
  }) => {
    if (this.socket?.id) {
      const data: SocketUpdateDataSource["MOUSE_LOCATION"] = {
        type: WS_SUBTYPES.MOUSE_LOCATION,
        payload: {
          socketId: this.socket.id as SocketId,
          pointer: payload.pointer,
          button: payload.button || "up",
          selectedElementIds:
            this.collab.excalidrawAPI.getAppState().selectedElementIds,
          username: this.collab.state.username,
        },
      };

      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
      );
    }
  };

  broadcastVisibleSceneBounds = (payload: {
    sceneBounds: SocketUpdateDataSource["USER_VISIBLE_SCENE_BOUNDS"]["payload"]["sceneBounds"];
  }) => {
    if (this.socket?.id) {
      const data: SocketUpdateDataSource["USER_VISIBLE_SCENE_BOUNDS"] = {
        type: WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS,
        payload: {
          socketId: this.socket.id as SocketId,
          username: this.collab.state.username,
          sceneBounds: payload.sceneBounds,
        },
      };

      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
        true, // followersOnly
      );
    }
  };

  broadcastPresentationLive = (payload: {
    isLive: boolean;
    slideIndex: number;
    totalSlides: number;
    slideTitle?: string;
    settings?: Partial<PresentationSettings>;
  }) => {
    if (this.socket?.id) {
      const data: SocketUpdateDataSource["PRESENTATION_BROADCAST"] = {
        type: WS_SUBTYPES.PRESENTATION_BROADCAST,
        payload: {
          socketId: this.socket.id as SocketId,
          username: this.collab.state.username,
          isLive: payload.isLive,
          slideIndex: payload.slideIndex,
          totalSlides: payload.totalSlides,
          slideTitle: payload.slideTitle,
          settings: payload.settings,
        },
      };

      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
      );
    }
  };

  broadcastPresentationControl = (payload: {
    action:
      | "NAVIGATE_SLIDE"
      | "NEXT_SLIDE"
      | "PREV_SLIDE"
      | "STOP_PRESENTATION"
      | "UPDATE_SETTINGS";
    slideIndex?: number;
    settings?: Partial<PresentationSettings>;
  }) => {
    if (this.socket?.id) {
      const data: SocketUpdateDataSource["PRESENTATION_CONTROL"] = {
        type: WS_SUBTYPES.PRESENTATION_CONTROL,
        payload,
      };

      return this._broadcastSocketData(
        data as SocketUpdateData,
        true, // volatile
        false, // followersOnly
        true, // allowViewers
      );
    }
  };

  broadcastUserFollowed = (payload: OnUserFollowedPayload) => {
    if (this.socket) {
      this.socket.setFollowing(
        payload.action === "FOLLOW" ? payload.userToFollow.socketId : null,
      );
    }
  };
}

export default Portal;
