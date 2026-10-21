import {
  CaptureUpdateAction,
  exportToCanvas,
  loadFromBlob,
  restoreAppState,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { updateStaleImageStatuses } from "./FileManager";
import { LocalData } from "./LocalData";
import {
  createScene,
  getActiveSceneId,
  markSceneOpened,
  notifyLibraryChanged,
  getSceneMeta,
  loadSceneData,
  saveScene,
  setActiveScene,
} from "./scenes";

import type { SceneData } from "./scenes";

const THUMBNAIL_SIZE = 480;

export const makeThumbnail = async (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
) => {
  const alive = elements.filter(
    (element) => !element.isDeleted,
  ) as NonDeletedExcalidrawElement[];
  if (!alive.length) {
    return null;
  }
  try {
    const canvas = await exportToCanvas({
      elements: alive,
      appState: { ...appState, exportBackground: true },
      files,
      maxWidthOrHeight: THUMBNAIL_SIZE,
      exportPadding: 16,
    });
    return canvas.toDataURL("image/webp", 0.7);
  } catch (error) {
    console.warn("Couldn't draw a scene thumbnail", error);
    return null;
  }
};

/** saves what is on the canvas into the active scene, with a fresh thumbnail */
export const snapshotActiveScene = async (api: ExcalidrawImperativeAPI) => {
  const id = getActiveSceneId();
  if (!id) {
    return;
  }
  LocalData.flushSave();
  const elements = api.getSceneElementsIncludingDeleted();
  const appState = api.getAppState();
  const thumbnail = await makeThumbnail(elements, appState, api.getFiles());
  await saveScene(id, elements, appState, thumbnail);
  notifyLibraryChanged();
};

const showScene = (api: ExcalidrawImperativeAPI, data: SceneData) => {
  const elements = restoreElements(data.elements, null, {
    repairBindings: true,
    deleteInvisibleElements: true,
  });
  const appState = restoreAppState(data.appState, null);

  api.resetScene();
  api.updateScene({
    elements,
    appState: {
      ...appState,
      // the theme is a setting of the app, not of one scene
      theme: api.getAppState().theme,
      isLoading: false,
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  api.history.clear();
  if (elements.length && data.appState.scrollX === undefined) {
    api.setViewport({ target: elements, fit: "scale-down" });
  }

  const fileIds = elements.flatMap((element) =>
    element.type === "image" && element.fileId ? [element.fileId] : [],
  );
  if (fileIds.length) {
    LocalData.fileStorage
      .getFiles(fileIds)
      .then(({ loadedFiles, erroredFiles }) => {
        if (loadedFiles.length) {
          api.addFiles(loadedFiles);
        }
        updateStaleImageStatuses({
          excalidrawAPI: api,
          erroredFiles,
          elements: api.getSceneElementsIncludingDeleted(),
        });
      });
  }
};

/** closes the scene being edited and opens another one */
export const openScene = async (api: ExcalidrawImperativeAPI, id: string) => {
  if (id === getActiveSceneId()) {
    return;
  }
  const data = await loadSceneData(id);
  if (!data) {
    return;
  }
  await snapshotActiveScene(api);
  await setActiveScene(id);
  await markSceneOpened(id);
  showScene(api, data);
};

/** starts an empty scene (in a collection, if given) and opens it */
export const openNewScene = async (
  api: ExcalidrawImperativeAPI,
  collectionId: string | null = null,
) => {
  await snapshotActiveScene(api);
  const meta = await createScene(undefined, undefined, collectionId);
  await setActiveScene(meta.id);
  showScene(api, { elements: [], appState: {} });
};

/** .excalidraw files become new scenes; returns how many were imported */
export const importSceneFiles = async (
  files: File[],
  collectionId: string | null,
) => {
  let imported = 0;
  for (const file of files) {
    try {
      const data = await loadFromBlob(file, null, null);
      const name = file.name.replace(/\.(excalidraw|json)$/i, "") || undefined;
      const scene = await createScene(
        { elements: data.elements, appState: data.appState },
        name,
        collectionId,
      );
      if (data.files && Object.keys(data.files).length) {
        await LocalData.fileStorage.saveFiles({
          elements: data.elements,
          files: data.files,
        });
      }
      const thumbnail = await makeThumbnail(
        data.elements,
        data.appState,
        data.files ?? {},
      );
      await saveScene(scene.id, data.elements, data.appState, thumbnail);
      imported++;
    } catch (error) {
      console.warn(`Couldn't import ${file.name}`, error);
    }
  }
  return imported;
};

/** downloads a scene as a .excalidraw file */
export const exportSceneFile = async (id: string) => {
  const [meta, data] = await Promise.all([getSceneMeta(id), loadSceneData(id)]);
  if (!meta || !data) {
    return;
  }
  const fileIds = meta.fileIds;
  const { loadedFiles } = fileIds.length
    ? await LocalData.fileStorage.getFiles(fileIds)
    : { loadedFiles: [] };
  const files = Object.fromEntries(loadedFiles.map((file) => [file.id, file]));
  const json = serializeAsJSON(
    data.elements,
    data.appState as AppState,
    files,
    "local",
  );
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/vnd.excalidraw+json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${meta.name}.excalidraw`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
