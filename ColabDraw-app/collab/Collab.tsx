import {
  CaptureUpdateAction,
  getSceneVersion,
  restoreElements,
  zoomToFitBounds,
  reconcileElements,
} from "@excalidraw/excalidraw";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { APP_NAME, cloneJSON, EVENT, toBrandedType } from "@excalidraw/common";
import {
  IDLE_THRESHOLD,
  ACTIVE_THRESHOLD,
  UserIdleState,
  assertNever,
  isDevEnv,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  throttleRAF,
} from "@excalidraw/common";
import { decryptData } from "@excalidraw/excalidraw/data/encryption";
import { getVisibleSceneBounds } from "@excalidraw/element";
import { newElementWith } from "@excalidraw/element";
import { isImageElement, isInitializedImageElement } from "@excalidraw/element";
import { AbortError } from "@excalidraw/excalidraw/errors";
import { t } from "@excalidraw/excalidraw/i18n";
import { withBatchedUpdates } from "@excalidraw/excalidraw/reactUtils";

import throttle from "lodash.throttle";
import { PureComponent } from "react";

import { bumpElementVersions } from "@excalidraw/excalidraw/data/restore";

import type {
  ReconciledExcalidrawElement,
  RemoteExcalidrawElement,
} from "@excalidraw/excalidraw/data/reconcile";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type {
  ExcalidrawElement,
  FileId,
  InitializedExcalidrawImageElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
  SocketId,
  Collaborator,
  Gesture,
  UserToFollow,
} from "@excalidraw/excalidraw/types";
import type { Mutable, ValueOf } from "@excalidraw/common/utility-types";

import { appJotaiStore, atom } from "../app-jotai";
import {
  CURSOR_SYNC_TIMEOUT,
  FILE_UPLOAD_MAX_BYTES,
  INITIAL_SCENE_UPDATE_TIMEOUT,
  LOAD_IMAGES_TIMEOUT,
  WS_SUBTYPES,
  SYNC_FULL_SCENE_INTERVAL_MS,
} from "../app_constants";
import {
  generateCollaborationLinkData,
  getCollaborationLink,
  getSyncableElements,
} from "../data";
import {
  encodeFilesForUpload,
  FileManager,
  updateStaleImageStatuses,
} from "../data/FileManager";
import { FileStatusStore } from "../data/fileStatusStore";
import { LocalData } from "../data/LocalData";
import {
  BACKEND_URL,
  isSavedToBackend,
  loadFilesFromBackend,
  loadFromBackend,
  saveFilesToBackend,
  saveToBackend,
} from "../data/backend";
import {
  importUsernameFromLocalStorage,
  saveUsernameToLocalStorage,
} from "../data/localStorage";
import { resetBrowserStateVersions } from "../data/tabSync";

import {
  activeRemotePresentationAtom,
  DEFAULT_PRESENTATION_STATE,
  presentationEndedAtom,
  presentationModeAtom,
  presentationSettingsAtom,
} from "../presentation/presentationState";
import { presentationSync } from "../presentation/presentationSync";

import { collabErrorIndicatorAtom } from "./CollabError";
import Portal from "./Portal";
import { CollabSocket } from "./CollabSocket";

import type { PresentationSettings } from "../presentation/presentationState";
import type {
  SocketUpdateDataSource,
  SyncableExcalidrawElement,
} from "../data";

export const collabAPIAtom = atom<CollabAPI | null>(null);
export const isCollaboratingAtom = atom(false);
export const isViewOnlyAtom = atom(false);
export const isOfflineAtom = atom(false);
export const syncUnavailableAtom = atom(false);

interface CollabState {
  errorMessage: string | null;
  /** errors related to saving */
  dialogNotifiedErrors: Record<string, boolean>;
  username: string;
  activeRoomLink: string | null;
}

export const activeRoomLinkAtom = atom<string | null>(null);
export const userToFollowAtom = atom<UserToFollow | null>(null);

type CollabInstance = InstanceType<typeof Collab>;

export interface CollabAPI {
  /** function so that we can access the latest value from stale callbacks */
  isCollaborating: () => boolean;
  onPointerUpdate: CollabInstance["onPointerUpdate"];
  startCollaboration: CollabInstance["startCollaboration"];
  stopCollaboration: CollabInstance["stopCollaboration"];
  syncElements: CollabInstance["syncElements"];
  fetchImageFiles: CollabInstance["fetchImageFiles"];
  setUsername: CollabInstance["setUsername"];
  getUsername: CollabInstance["getUsername"];
  getActiveRoomLink: CollabInstance["getActiveRoomLink"];
  setCollabError: CollabInstance["setErrorDialog"];
  setUserToFollow: CollabInstance["setUserToFollow"];
  broadcastPresentation: (payload: {
    isLive: boolean;
    slideIndex: number;
    totalSlides: number;
    slideTitle?: string;
    settings?: Partial<PresentationSettings>;
  }) => void;
  broadcastPresentationControl: (payload: {
    action:
      | "NAVIGATE_SLIDE"
      | "NEXT_SLIDE"
      | "PREV_SLIDE"
      | "STOP_PRESENTATION"
      | "UPDATE_SETTINGS";
    slideIndex?: number;
    settings?: Partial<PresentationSettings>;
  }) => Promise<void> | void;
  relayVisibleSceneBounds: (props?: { force: boolean }) => void;
}

interface CollabProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
}

class Collab extends PureComponent<CollabProps, CollabState> {
  portal: Portal;
  fileManager: FileManager;
  excalidrawAPI: CollabProps["excalidrawAPI"];
  activeIntervalId: number | null;
  idleTimeoutId: number | null;

  private socketInitializationTimer?: number;
  private lastBroadcastedOrReceivedSceneVersion: number = -1;
  private collaborators = new Map<SocketId, Collaborator>();
  /** the socket ids of the users following the current user */
  private followedBy = new Set<SocketId>();

  constructor(props: CollabProps) {
    super(props);
    this.state = {
      errorMessage: null,
      dialogNotifiedErrors: {},
      username: importUsernameFromLocalStorage() || "",
      activeRoomLink: null,
    };
    this.portal = new Portal(this);
    this.fileManager = new FileManager({
      onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
      getFiles: async (fileIds) => {
        const { roomId, roomKey } = this.portal;
        if (!roomId || !roomKey) {
          throw new AbortError();
        }

        return loadFilesFromBackend(roomKey, fileIds, roomId);
      },
      saveFiles: async ({ addedFiles }) => {
        const { roomId, roomKey } = this.portal;
        if (!roomId || !roomKey) {
          throw new AbortError();
        }

        const { savedFiles, erroredFiles } = await saveFilesToBackend({
          files: await encodeFilesForUpload({
            files: addedFiles,
            encryptionKey: roomKey,
            maxBytes: FILE_UPLOAD_MAX_BYTES,
          }),
          ownerId: roomId,
        });

        const savedFilesMap = new Map<FileId, BinaryFileData>();
        for (const id of savedFiles.keys()) {
          const fileData = addedFiles.get(id);
          if (fileData) {
            savedFilesMap.set(id, fileData);
          }
        }

        const erroredFilesMap = new Map<FileId, BinaryFileData>();
        for (const id of erroredFiles.keys()) {
          const fileData = addedFiles.get(id);
          if (fileData) {
            erroredFilesMap.set(id, fileData);
          }
        }

        return {
          savedFiles: savedFilesMap,
          erroredFiles: erroredFilesMap,
        };
      },
    });
    this.excalidrawAPI = props.excalidrawAPI;
    this.activeIntervalId = null;
    this.idleTimeoutId = null;
  }

  private onUmmount: (() => void) | null = null;

  componentDidMount() {
    window.addEventListener(EVENT.BEFORE_UNLOAD, this.beforeUnload);
    window.addEventListener("online", this.onOfflineStatusToggle);
    window.addEventListener("offline", this.onOfflineStatusToggle);
    window.addEventListener(EVENT.UNLOAD, this.onUnload);

    const unsubOnUserFollow = this.excalidrawAPI.onUserFollow((payload) => {
      this.setUserToFollow(
        payload.action === "FOLLOW" ? payload.userToFollow : null,
      );
    });
    const throttledRelayUserViewportBounds = throttleRAF(
      this.relayVisibleSceneBounds,
    );
    const unsubOnScrollChange = this.excalidrawAPI.onScrollChange(() =>
      throttledRelayUserViewportBounds(),
    );
    this.onUmmount = () => {
      unsubOnUserFollow();
      unsubOnScrollChange();
    };

    this.onOfflineStatusToggle();

    const collabAPI: CollabAPI = {
      isCollaborating: this.isCollaborating,
      onPointerUpdate: this.onPointerUpdate,
      startCollaboration: this.startCollaboration,
      syncElements: this.syncElements,
      fetchImageFiles: this.fetchImageFiles,
      stopCollaboration: this.stopCollaboration,
      setUsername: this.setUsername,
      getUsername: this.getUsername,
      getActiveRoomLink: this.getActiveRoomLink,
      setCollabError: this.setErrorDialog,
      setUserToFollow: this.setUserToFollow,
      broadcastPresentation: (payload) =>
        this.portal.broadcastPresentationLive(payload),
      broadcastPresentationControl: (payload) =>
        this.portal.broadcastPresentationControl(payload),
      relayVisibleSceneBounds: (props) => this.relayVisibleSceneBounds(props),
    };

    appJotaiStore.set(collabAPIAtom, collabAPI);

    if (isTestEnv() || isDevEnv()) {
      window.collab = window.collab || ({} as Window["collab"]);
      Object.defineProperties(window, {
        collab: {
          configurable: true,
          value: this,
        },
      });
    }
  }

  onOfflineStatusToggle = () => {
    appJotaiStore.set(isOfflineAtom, !window.navigator.onLine);
  };

  componentWillUnmount() {
    window.removeEventListener("online", this.onOfflineStatusToggle);
    window.removeEventListener("offline", this.onOfflineStatusToggle);
    window.removeEventListener(EVENT.BEFORE_UNLOAD, this.beforeUnload);
    window.removeEventListener(EVENT.UNLOAD, this.onUnload);
    window.removeEventListener(EVENT.POINTER_MOVE, this.onPointerMove);
    window.removeEventListener(
      EVENT.VISIBILITY_CHANGE,
      this.onVisibilityChange,
    );
    if (this.activeIntervalId) {
      window.clearInterval(this.activeIntervalId);
      this.activeIntervalId = null;
    }
    if (this.idleTimeoutId) {
      window.clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
    this.onUmmount?.();
  }

  isCollaborating = () => appJotaiStore.get(isCollaboratingAtom)!;
  isViewOnly = () => appJotaiStore.get(isViewOnlyAtom)!;

  private setIsCollaborating = (isCollaborating: boolean) => {
    appJotaiStore.set(isCollaboratingAtom, isCollaborating);
  };

  private onUnload = () => {
    this.destroySocketClient({ isUnload: true });
  };

  private beforeUnload = withBatchedUpdates((event: BeforeUnloadEvent) => {
    // viewers have nothing to save, so don't nag them on close
    if (this.isViewOnly()) {
      return;
    }

    const syncableElements = getSyncableElements(
      this.getSceneElementsIncludingDeleted(),
    );

    if (
      this.isCollaborating() &&
      (this.fileManager.shouldPreventUnload(syncableElements) ||
        !isSavedToBackend(this.portal, syncableElements))
    ) {
      // this won't run in time if user decides to leave the site, but
      //  the purpose is to run in immediately after user decides to stay
      this.saveCollabRoomToBackend(syncableElements);

      if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
        preventUnload(event);
      } else {
        console.warn(
          "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
        );
      }
    }
  });

  saveCollabRoomToBackend = async (
    syncableElements: readonly SyncableExcalidrawElement[],
  ) => {
    // a viewer must never write the room back, even if its scene is stale
    if (this.isViewOnly()) {
      return;
    }
    syncableElements = cloneJSON(syncableElements);
    try {
      const storedElements = await saveToBackend(
        this.portal,
        syncableElements,
        this.excalidrawAPI.getAppState(),
      );

      this.resetErrorIndicator();

      if (this.isCollaborating() && storedElements) {
        this.handleRemoteSceneUpdate(this._reconcileElements(storedElements));
      }
    } catch (error: any) {
      const errorMessage =
        error?.status === 413 ||
        /is longer than.*?bytes/.test(error.message ?? "")
          ? t("errors.collabSaveFailed_sizeExceeded")
          : t("errors.collabSaveFailed");

      if (
        !this.state.dialogNotifiedErrors[errorMessage] ||
        !this.isCollaborating()
      ) {
        this.setErrorDialog(errorMessage);
        this.setState({
          dialogNotifiedErrors: {
            ...this.state.dialogNotifiedErrors,
            [errorMessage]: true,
          },
        });
      }

      if (this.isCollaborating()) {
        this.setErrorIndicator(errorMessage);
      }

      console.error(error);
    }
  };

  stopCollaboration = (keepRemoteState = true) => {
    this.queueBroadcastAllElements.cancel();
    this.queueSaveToBackend.cancel();
    this.loadImageFiles.cancel();
    this.resetErrorIndicator(true);

    if (this.isViewOnly()) {
      // leaving is all a viewer can do: nothing to save, no confirmation
      window.history.pushState({}, APP_NAME, window.location.origin);
      this.destroySocketClient();
      this.excalidrawAPI.updateScene({ appState: { viewModeEnabled: false } });
      LocalData.fileStorage.reset();
      return;
    }

    this.saveCollabRoomToBackend(
      getSyncableElements(
        this.excalidrawAPI.getSceneElementsIncludingDeleted(),
      ),
    );

    if (!keepRemoteState) {
      LocalData.fileStorage.reset();
      this.destroySocketClient();
    } else if (window.confirm(t("alerts.collabStopOverridePrompt"))) {
      // hack to ensure that we prefer we disregard any new browser state
      // that could have been saved in other tabs while we were collaborating
      resetBrowserStateVersions();

      window.history.pushState({}, APP_NAME, window.location.origin);
      this.destroySocketClient();

      LocalData.fileStorage.reset();

      const elements = this.excalidrawAPI
        .getSceneElementsIncludingDeleted()
        .map((element) => {
          if (isImageElement(element) && element.status === "saved") {
            return newElementWith(element, { status: "pending" });
          }
          return element;
        });

      this.excalidrawAPI.updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  };

  private destroySocketClient = (opts?: { isUnload: boolean }) => {
    this.lastBroadcastedOrReceivedSceneVersion = -1;
    this.portal.close();
    this.fileManager.reset();
    this.followedBy = new Set();
    appJotaiStore.set(syncUnavailableAtom, false);
    if (!opts?.isUnload) {
      this.setIsCollaborating(false);
      appJotaiStore.set(isViewOnlyAtom, false);
      this.setActiveRoomLink(null);
      appJotaiStore.set(userToFollowAtom, null);
      this.collaborators = new Map();
      this.excalidrawAPI.updateScene({
        collaborators: this.collaborators,
      });
      LocalData.resumeSave("collaboration");
    }
  };

  private fetchImageFiles = async (opts: {
    elements: readonly ExcalidrawElement[];
    /**
     * Indicates whether to fetch files that are errored or pending and older
     * than 10 seconds.
     *
     * Use this as a mechanism to fetch files which may be ok but for some
     * reason their status was not updated correctly.
     */
    forceFetchFiles?: boolean;
  }) => {
    const unfetchedImages = opts.elements
      .filter((element) => {
        return (
          isInitializedImageElement(element) &&
          !this.fileManager.isFileTracked(element.fileId) &&
          !element.isDeleted &&
          (opts.forceFetchFiles
            ? element.status !== "pending" ||
              Date.now() - element.updated > 10000
            : element.status === "saved")
        );
      })
      .map((element) => (element as InitializedExcalidrawImageElement).fileId);

    return await this.fileManager.getFiles(unfetchedImages);
  };

  private decryptPayload = async (
    iv: Uint8Array,
    encryptedData: ArrayBuffer,
    decryptionKey: string,
  ): Promise<ValueOf<SocketUpdateDataSource>> => {
    try {
      const decrypted = await decryptData(
        iv as Uint8Array<ArrayBuffer>,
        encryptedData,
        decryptionKey,
      );

      const decodedData = new TextDecoder("utf-8").decode(
        new Uint8Array(decrypted),
      );
      return JSON.parse(decodedData);
    } catch (error) {
      window.alert(t("alerts.decryptFailed"));
      console.error(error);
      return {
        type: WS_SUBTYPES.INVALID_RESPONSE,
      };
    }
  };

  private fallbackInitializationHandler: null | (() => any) = null;

  startCollaboration = async (
    existingRoomLinkData: null | {
      roomId: string;
      roomKey: string;
      isViewOnly?: boolean;
    },
  ) => {
    if (!this.state.username) {
      import("@excalidraw/random-username").then(({ getRandomUsername }) => {
        const username = getRandomUsername();
        this.setUsername(username);
      });
    }

    if (this.portal.socket) {
      return null;
    }

    let roomId;
    let roomKey;
    let isViewOnly = false;

    if (existingRoomLinkData) {
      ({ roomId, roomKey } = existingRoomLinkData);
      isViewOnly = !!existingRoomLinkData.isViewOnly;
    } else {
      ({ roomId, roomKey } = await generateCollaborationLinkData());
      window.history.pushState(
        {},
        APP_NAME,
        getCollaborationLink({ roomId, roomKey }),
      );
    }

    // TODO: `ImportedDataState` type here seems abused
    const scenePromise = resolvablePromise<
      | (ImportedDataState & { elements: readonly OrderedExcalidrawElement[] })
      | null
    >();

    this.setIsCollaborating(true);
    appJotaiStore.set(isViewOnlyAtom, isViewOnly);
    LocalData.pauseSave("collaboration");

    const fallbackInitializationHandler = () => {
      this.initializeRoom({
        roomLinkData: existingRoomLinkData,
        fetchScene: true,
      }).then((scene) => {
        scenePromise.resolve(scene);
      });
    };
    this.fallbackInitializationHandler = fallbackInitializationHandler;

    try {
      const socket = new CollabSocket(BACKEND_URL, roomId, { isViewOnly });
      this.portal.open(socket, roomId, roomKey, isViewOnly);

      let hasConnected = false;
      this.portal.socket!.on("status", (status) => {
        if (status === "open") {
          if (hasConnected) {
            // a reconnect must accept the peers' SCENE_INIT again
            this.portal.socketInitialized = false;
          }
          hasConnected = true;
          appJotaiStore.set(syncUnavailableAtom, false);
        }
        if (status === "unavailable") {
          appJotaiStore.set(syncUnavailableAtom, true);
          fallbackInitializationHandler();
        }
      });
    } catch (error: any) {
      console.error(error);
      this.setErrorDialog(error.message);
      return null;
    }

    if (existingRoomLinkData) {
      // when joining existing room, don't merge it with current scene data
      this.excalidrawAPI.resetScene();
    } else {
      const elements = this.excalidrawAPI.getSceneElements().map((element) => {
        if (isImageElement(element) && element.status === "saved") {
          return newElementWith(element, { status: "pending" });
        }
        return element;
      });
      // remove deleted elements from elements array to ensure we don't
      // expose potentially sensitive user data in case user manually deletes
      // existing elements (or clears scene), which would otherwise be persisted
      // to database even if deleted before creating the room.
      this.excalidrawAPI.updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      this.saveCollabRoomToBackend(getSyncableElements(elements));
    }

    // fallback in case you're not alone in the room but still don't receive
    // initial SCENE_INIT message
    this.socketInitializationTimer = window.setTimeout(
      fallbackInitializationHandler,
      INITIAL_SCENE_UPDATE_TIMEOUT,
    );

    // All socket listeners are moving to Portal
    this.portal.socket!.on("scene", async ({ iv, data }) => {
      if (!this.portal.roomKey) {
        return;
      }

      const decryptedData = await this.decryptPayload(
        iv,
        data.buffer as ArrayBuffer,
        this.portal.roomKey,
      );

      switch (decryptedData.type) {
        case WS_SUBTYPES.INVALID_RESPONSE:
          return;
        case WS_SUBTYPES.INIT: {
          if (!this.portal.socketInitialized) {
            this.initializeRoom({ fetchScene: false });
            const remoteElements = toBrandedType<
              readonly RemoteExcalidrawElement[]
            >(decryptedData.payload.elements);
            const reconciledElements = this._reconcileElements(remoteElements);
            this.handleRemoteSceneUpdate(reconciledElements);
            // noop if already resolved via init from firebase
            scenePromise.resolve({
              elements: reconciledElements,
              scrollToContent: true,
            });
          }
          break;
        }
        case WS_SUBTYPES.UPDATE:
          this.handleRemoteSceneUpdate(
            this._reconcileElements(
              toBrandedType<readonly RemoteExcalidrawElement[]>(
                decryptedData.payload.elements,
              ),
            ),
          );
          break;
        case WS_SUBTYPES.MOUSE_LOCATION: {
          const { pointer, button, username, selectedElementIds } =
            decryptedData.payload;

          const socketId: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["socketId"] =
            decryptedData.payload.socketId ||
            // @ts-ignore legacy, see #2094 (#2097)
            decryptedData.payload.socketID;

          this.updateCollaborator(socketId, {
            pointer,
            button,
            selectedElementIds,
            username,
          });

          break;
        }

        case WS_SUBTYPES.USER_VISIBLE_SCENE_BOUNDS: {
          const { sceneBounds, socketId } = decryptedData.payload;

          const userToFollow = appJotaiStore.get(userToFollowAtom);

          // we're not following the user
          // (shouldn't happen, but could be late message or bug upstream)
          if (userToFollow?.socketId !== socketId) {
            console.warn(
              `receiving remote client's (from ${socketId}) viewport bounds even though we're not subscribed to it!`,
            );
            return;
          }

          // cross-follow case, ignore updates in this case
          if (this.followedBy.has(userToFollow.socketId)) {
            return;
          }

          const appState = this.excalidrawAPI.getAppState();

          this.excalidrawAPI.updateScene({
            appState: zoomToFitBounds({
              appState,
              bounds: sceneBounds,
              fit: "contain",
            }).appState,
          });

          break;
        }

        case WS_SUBTYPES.IDLE_STATUS: {
          const { userState, socketId, username } = decryptedData.payload;
          this.updateCollaborator(socketId, {
            userState,
            username,
          });
          break;
        }

        case WS_SUBTYPES.PRESENTATION_BROADCAST: {
          const {
            socketId,
            username,
            isLive,
            slideIndex,
            totalSlides,
            slideTitle,
          } = decryptedData.payload;

          if (isLive) {
            appJotaiStore.set(activeRemotePresentationAtom, {
              presenterSocketId: socketId,
              presenterUsername: username || "Presenter",
              slideIndex,
              totalSlides,
              slideTitle,
              settings: decryptedData.payload.settings,
            });

            if (decryptedData.payload.settings) {
              appJotaiStore.set(presentationSettingsAtom, (prev) => ({
                ...prev,
                ...decryptedData.payload.settings,
              }));
              this.syncPresenterCursorVisibility();
            }

            const currentPresState = appJotaiStore.get(presentationModeAtom);
            if (
              currentPresState.isFollower &&
              currentPresState.presenterSocketId === socketId
            ) {
              appJotaiStore.set(presentationModeAtom, (prev) => ({
                ...prev,
                currentSlideIndex: slideIndex,
                totalSlides,
              }));
            }
          } else {
            const currentRemote = appJotaiStore.get(
              activeRemotePresentationAtom,
            );
            if (currentRemote?.presenterSocketId === socketId) {
              appJotaiStore.set(activeRemotePresentationAtom, null);
            }
            const currentPresState = appJotaiStore.get(presentationModeAtom);
            if (
              currentPresState.isFollower &&
              currentPresState.presenterSocketId === socketId
            ) {
              appJotaiStore.set(presentationEndedAtom, {
                presenterUsername:
                  username || currentPresState.presenterUsername || null,
                wasFollower: true,
                shareUrl: null,
              });
              this.setUserToFollow(null);
              appJotaiStore.set(
                presentationModeAtom,
                DEFAULT_PRESENTATION_STATE,
              );
            }
          }
          break;
        }

        case WS_SUBTYPES.PRESENTATION_CONTROL: {
          const { action, slideIndex, settings } = decryptedData.payload;
          const currentPres = appJotaiStore.get(presentationModeAtom);

          if (action === "UPDATE_SETTINGS" && settings) {
            appJotaiStore.set(presentationSettingsAtom, (prev) => ({
              ...prev,
              ...settings,
            }));
            presentationSync.send({
              type: "UPDATE_SETTINGS",
              settings,
            });
            this.syncPresenterCursorVisibility();
            break;
          }

          if (action === "STOP_PRESENTATION") {
            if (currentPres.isFollower) {
              appJotaiStore.set(presentationEndedAtom, {
                presenterUsername: currentPres.presenterUsername,
                wasFollower: true,
                shareUrl: null,
              });
            }
            presentationSync.send({ type: "STOP_PRESENTATION" });
            appJotaiStore.set(presentationModeAtom, DEFAULT_PRESENTATION_STATE);
            appJotaiStore.set(activeRemotePresentationAtom, null);
            this.portal.broadcastPresentationLive({
              isLive: false,
              slideIndex: 0,
              totalSlides: 0,
            });
            break;
          }

          if (currentPres.isActive) {
            if (action === "NEXT_SLIDE") {
              presentationSync.send({ type: "NEXT_SLIDE" });
            } else if (action === "PREV_SLIDE") {
              presentationSync.send({ type: "PREV_SLIDE" });
            } else if (
              action === "NAVIGATE_SLIDE" &&
              typeof slideIndex === "number"
            ) {
              presentationSync.send({ type: "NAVIGATE_SLIDE", slideIndex });
            }
          }
          break;
        }

        default: {
          assertNever(decryptedData, null);
        }
      }
    });

    this.portal.socket!.on("joined", async ({ first }) => {
      if (!first) {
        return; // peers will send SCENE_INIT
      }
      if (this.portal.socketInitialized) {
        return; // reconnect while alone: keep local edits
      }
      const sceneData = await this.initializeRoom({
        fetchScene: true,
        roomLinkData: existingRoomLinkData,
      });
      scenePromise.resolve(sceneData);
    });

    this.portal.socket!.on("followers", (followedBy: string[]) => {
      this.followedBy = new Set(followedBy as SocketId[]);

      this.relayVisibleSceneBounds({ force: true });
    });

    this.initializeIdleDetector();

    this.setActiveRoomLink(window.location.href);

    return scenePromise;
  };

  private initializeRoom = async ({
    fetchScene,
    roomLinkData,
  }:
    | {
        fetchScene: true;
        roomLinkData: { roomId: string; roomKey: string } | null;
      }
    | { fetchScene: false; roomLinkData?: null }) => {
    clearTimeout(this.socketInitializationTimer!);
    if (fetchScene && roomLinkData && this.portal.socket) {
      this.excalidrawAPI.resetScene();

      try {
        const elements = await loadFromBackend(
          roomLinkData.roomId,
          roomLinkData.roomKey,
          this.portal.socket,
        );
        if (elements) {
          this.setLastBroadcastedOrReceivedSceneVersion(
            getSceneVersion(elements),
          );

          return {
            elements,
            scrollToContent: true,
          };
        }
      } catch (error: any) {
        // log the error and move on. other peers will sync us the scene.
        console.error(error);
      } finally {
        this.portal.socketInitialized = true;
      }
    } else {
      this.portal.socketInitialized = true;
    }
    return null;
  };

  private _reconcileElements = (
    remoteElements: readonly RemoteExcalidrawElement[],
  ): ReconciledExcalidrawElement[] => {
    const appState = this.excalidrawAPI.getAppState();

    const existingElements = this.getSceneElementsIncludingDeleted();

    // NOTE ideally we restore _after_ reconciliation but we can't do that
    // as we'd regenerate even elements such as appState.newElement which would
    // break the state
    remoteElements = restoreElements(remoteElements, existingElements);

    let reconciledElements = reconcileElements(
      existingElements,
      remoteElements,
      appState,
    );

    reconciledElements = bumpElementVersions(
      reconciledElements,
      existingElements,
    );

    // Avoid broadcasting to the rest of the collaborators the scene
    // we just received!
    // Note: this needs to be set before updating the scene as it
    // synchronously calls render.
    this.setLastBroadcastedOrReceivedSceneVersion(
      getSceneVersion(reconciledElements),
    );

    return reconciledElements;
  };

  private loadImageFiles = throttle(async () => {
    const { loadedFiles, erroredFiles } = await this.fetchImageFiles({
      elements: this.excalidrawAPI.getSceneElementsIncludingDeleted(),
    });

    this.excalidrawAPI.addFiles(loadedFiles);

    updateStaleImageStatuses({
      excalidrawAPI: this.excalidrawAPI,
      erroredFiles,
      elements: this.excalidrawAPI.getSceneElementsIncludingDeleted(),
    });
  }, LOAD_IMAGES_TIMEOUT);

  private handleRemoteSceneUpdate = (
    elements: ReconciledExcalidrawElement[],
  ) => {
    this.excalidrawAPI.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    this.loadImageFiles();
  };

  private onPointerMove = () => {
    if (this.idleTimeoutId) {
      window.clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }

    this.idleTimeoutId = window.setTimeout(this.reportIdle, IDLE_THRESHOLD);

    if (!this.activeIntervalId) {
      this.activeIntervalId = window.setInterval(
        this.reportActive,
        ACTIVE_THRESHOLD,
      );
    }
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      if (this.idleTimeoutId) {
        window.clearTimeout(this.idleTimeoutId);
        this.idleTimeoutId = null;
      }
      if (this.activeIntervalId) {
        window.clearInterval(this.activeIntervalId);
        this.activeIntervalId = null;
      }
      this.onIdleStateChange(UserIdleState.AWAY);
    } else {
      this.idleTimeoutId = window.setTimeout(this.reportIdle, IDLE_THRESHOLD);
      this.activeIntervalId = window.setInterval(
        this.reportActive,
        ACTIVE_THRESHOLD,
      );
      this.onIdleStateChange(UserIdleState.ACTIVE);
    }
  };

  private reportIdle = () => {
    this.onIdleStateChange(UserIdleState.IDLE);
    if (this.activeIntervalId) {
      window.clearInterval(this.activeIntervalId);
      this.activeIntervalId = null;
    }
  };

  private reportActive = () => {
    this.onIdleStateChange(UserIdleState.ACTIVE);
  };

  private initializeIdleDetector = () => {
    document.addEventListener(EVENT.POINTER_MOVE, this.onPointerMove);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, this.onVisibilityChange);
  };

  setCollaborators(sockets: SocketId[]) {
    const collaborators: InstanceType<typeof Collab>["collaborators"] =
      new Map();
    for (const socketId of sockets) {
      const isCurrentUser = socketId === this.portal.socket?.id;
      collaborators.set(
        socketId,
        Object.assign(
          // we never receive our own broadcasts, so we need to seed
          // our own collaborator entry with the local username
          isCurrentUser ? { username: this.state.username } : {},
          this.collaborators.get(socketId),
          { isCurrentUser },
        ),
      );
    }
    this.collaborators = collaborators;
    this.excalidrawAPI.updateScene({ collaborators });

    // unfollow if the followed user left the room
    const userToFollow = appJotaiStore.get(userToFollowAtom);
    if (userToFollow && !collaborators.has(userToFollow.socketId)) {
      this.setUserToFollow(null);
    }
  }

  private getFollowerPresenterSocketId = (): SocketId | null => {
    const pres = appJotaiStore.get(presentationModeAtom);
    return pres.isFollower && pres.presenterSocketId
      ? (pres.presenterSocketId as SocketId)
      : null;
  };

  public syncPresenterCursorVisibility = () => {
    const presenterId = this.getFollowerPresenterSocketId();
    if (!presenterId) {
      return;
    }
    const collaborator = this.collaborators.get(presenterId);
    if (!collaborator?.pointer) {
      return;
    }
    const settings = appJotaiStore.get(presentationSettingsAtom);
    this.updateCollaborator(presenterId, {
      pointer: {
        ...collaborator.pointer,
        renderCursor: settings.showCursor,
      },
    });
  };

  updateCollaborator = (socketId: SocketId, updates: Partial<Collaborator>) => {
    const isCurrentUser = socketId === this.portal.socket?.id;
    const collaborators = new Map(this.collaborators);
    const user: Mutable<Collaborator> = Object.assign(
      // we never receive our own broadcasts, so we need to seed
      // our own collaborator entry with the local username
      isCurrentUser ? { username: this.state.username } : {},
      collaborators.get(socketId),
      updates,
      { isCurrentUser },
    );
    collaborators.set(socketId, user);
    this.collaborators = collaborators;

    this.excalidrawAPI.updateScene({
      collaborators,
    });
  };

  public setLastBroadcastedOrReceivedSceneVersion = (version: number) => {
    this.lastBroadcastedOrReceivedSceneVersion = version;
  };

  public getLastBroadcastedOrReceivedSceneVersion = () => {
    return this.lastBroadcastedOrReceivedSceneVersion;
  };

  public getSceneElementsIncludingDeleted = () => {
    return this.excalidrawAPI.getSceneElementsIncludingDeleted();
  };

  onPointerUpdate = throttle(
    (payload: {
      pointer: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["pointer"];
      button: SocketUpdateDataSource["MOUSE_LOCATION"]["payload"]["button"];
      pointersMap: Gesture["pointers"];
    }) => {
      if (!this.portal.socket || payload.pointersMap.size >= 2) {
        return;
      }
      // When presenting with "show cursor" disabled, keep broadcasting
      // (so the laser trail still reaches the audience) but ask viewers not
      // to render our cursor or username.
      const presentation = appJotaiStore.get(presentationModeAtom);
      const presentationSettings = appJotaiStore.get(presentationSettingsAtom);
      const hideCursorFromAudience =
        presentation.isActive && !presentationSettings.showCursor;

      this.portal.broadcastMouseLocation({
        pointer: hideCursorFromAudience
          ? { ...payload.pointer, renderCursor: false }
          : payload.pointer,
        button: payload.button,
      });
    },
    CURSOR_SYNC_TIMEOUT,
  );

  relayVisibleSceneBounds = (props?: { force: boolean }) => {
    if (this.portal.socket && (this.followedBy.size > 0 || props?.force)) {
      this.portal.broadcastVisibleSceneBounds({
        sceneBounds: getVisibleSceneBounds(this.excalidrawAPI.getAppState()),
      });
    }
  };

  onIdleStateChange = (userState: UserIdleState) => {
    this.portal.broadcastIdleChange(userState);
  };

  broadcastElements = (elements: readonly OrderedExcalidrawElement[]) => {
    if (
      getSceneVersion(elements) >
      this.getLastBroadcastedOrReceivedSceneVersion()
    ) {
      this.portal.broadcastScene(WS_SUBTYPES.UPDATE, elements, false);
      this.lastBroadcastedOrReceivedSceneVersion = getSceneVersion(elements);
      this.queueBroadcastAllElements();
    }
  };

  syncElements = (elements: readonly OrderedExcalidrawElement[]) => {
    if (this.isViewOnly()) {
      return;
    }
    this.broadcastElements(elements);
    this.queueSaveToBackend();
  };

  queueBroadcastAllElements = throttle(() => {
    this.portal.broadcastScene(
      WS_SUBTYPES.UPDATE,
      this.excalidrawAPI.getSceneElementsIncludingDeleted(),
      true,
    );
    const currentVersion = this.getLastBroadcastedOrReceivedSceneVersion();
    const newVersion = Math.max(
      currentVersion,
      getSceneVersion(this.getSceneElementsIncludingDeleted()),
    );
    this.setLastBroadcastedOrReceivedSceneVersion(newVersion);
  }, SYNC_FULL_SCENE_INTERVAL_MS);

  queueSaveToBackend = throttle(
    () => {
      if (this.portal.socketInitialized) {
        this.saveCollabRoomToBackend(
          getSyncableElements(
            this.excalidrawAPI.getSceneElementsIncludingDeleted(),
          ),
        );
      }
    },
    SYNC_FULL_SCENE_INTERVAL_MS,
    { leading: false },
  );

  setUserToFollow = (userToFollow: UserToFollow | null) => {
    const prev = appJotaiStore.get(userToFollowAtom) ?? null;

    if (prev?.socketId !== userToFollow?.socketId && this.portal.socket) {
      // leave the previous user's follow room before joining the next one
      if (prev) {
        this.portal.broadcastUserFollowed({
          userToFollow: prev,
          action: "UNFOLLOW",
        });
      }
      if (userToFollow) {
        this.portal.broadcastUserFollowed({
          userToFollow,
          action: "FOLLOW",
        });
      }
    }

    appJotaiStore.set(userToFollowAtom, userToFollow);
  };

  setUsername = (username: string) => {
    this.setState({ username });
    saveUsernameToLocalStorage(username);

    // keep our own collaborator entry in sync
    const socketId = this.portal.socket?.id as SocketId | undefined;
    if (socketId && this.collaborators.has(socketId)) {
      this.updateCollaborator(socketId, { username });
    }
  };

  getUsername = () => this.state.username;

  setActiveRoomLink = (activeRoomLink: string | null) => {
    this.setState({ activeRoomLink });
    appJotaiStore.set(activeRoomLinkAtom, activeRoomLink);
  };

  getActiveRoomLink = () => this.state.activeRoomLink;

  setErrorIndicator = (errorMessage: string | null) => {
    appJotaiStore.set(collabErrorIndicatorAtom, {
      message: errorMessage,
      nonce: Date.now(),
    });
  };

  resetErrorIndicator = (resetDialogNotifiedErrors = false) => {
    appJotaiStore.set(collabErrorIndicatorAtom, { message: null, nonce: 0 });
    if (resetDialogNotifiedErrors) {
      this.setState({
        dialogNotifiedErrors: {},
      });
    }
  };

  setErrorDialog = (errorMessage: string | null) => {
    this.setState({
      errorMessage,
    });
  };

  render() {
    const { errorMessage } = this.state;

    return (
      <>
        {errorMessage != null && (
          <ErrorDialog onClose={() => this.setErrorDialog(null)}>
            {errorMessage}
          </ErrorDialog>
        )}
      </>
    );
  }
}

declare global {
  interface Window {
    collab: InstanceType<typeof Collab>;
  }
}

if (isTestEnv() || isDevEnv()) {
  window.collab = window.collab || ({} as Window["collab"]);
}

export default Collab;

export type TCollabClass = Collab;
