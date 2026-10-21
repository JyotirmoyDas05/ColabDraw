/**
 * The scene library: every scene this browser has, kept in IndexedDB.
 *
 * The editor keeps working on a single "working copy" in localStorage (see
 * LocalData.ts), so collaboration, tab sync and reloads behave as before.
 * This file adds named scenes around it: the working copy is saved into the
 * active scene's record, and switching scenes swaps the working copy.
 *
 * Each scene is two records so the dashboard can list scenes without loading
 * every drawing: `meta:<id>` (name, times, thumbnail) and `data:<id>`.
 */

import { clearAppStateForLocalStorage } from "@excalidraw/excalidraw/appState";
import { getNonDeletedElements } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import { createStore, del, get, getMany, keys, set } from "idb-keyval";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";

const store = createStore("scenes-db", "scenes-store");
const ACTIVE_KEY = "colabdraw-active-scene";

export const DEFAULT_SCENE_NAME = "Untitled scene";

export type SceneMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** small png/webp data URL, null while the scene is empty or not yet drawn */
  thumbnail: string | null;
  /** images the scene uses, so they aren't cleaned out of the shared store */
  fileIds: FileId[];
  elementCount: number;
  /** set while the scene sits in the trash */
  deletedAt: number | null;
  /** null: the default "Private" collection */
  collectionId: string | null;
  pinned: boolean;
  /** last time the scene was opened in the editor */
  openedAt: number;
  author: string;
};

export type Collection = {
  id: string;
  name: string;
  /** an emoji */
  icon: string;
  createdAt: number;
};

export type SceneData = {
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
};

/** id and name of the scene being edited, for the title next to the menu */
export const activeSceneAtom = atom<{ id: string; name: string } | null>(null);

/** bumped whenever the library changes, so open lists reload */
export const libraryVersionAtom = atom(0);
const libraryChanged = () =>
  appJotaiStore.set(libraryVersionAtom, (version) => version + 1);

const metaKey = (id: string) => `meta:${id}`;
const dataKey = (id: string) => `data:${id}`;

const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const fileIdsOf = (elements: readonly ExcalidrawElement[]) =>
  elements.reduce<FileId[]>(
    (ids, element) =>
      isInitializedImageElement(element) && !ids.includes(element.fileId)
        ? [...ids, element.fileId]
        : ids,
    [],
  );

export const getActiveSceneId = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

const rememberActive = (meta: SceneMeta | null) => {
  try {
    if (meta) {
      localStorage.setItem(ACTIVE_KEY, meta.id);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    // storage blocked: the app falls back to making a scene on next start
  }
  appJotaiStore.set(
    activeSceneAtom,
    meta ? { id: meta.id, name: meta.name } : null,
  );
};

const withDefaults = (meta: SceneMeta): SceneMeta => ({
  ...meta,
  collectionId: meta.collectionId ?? null,
  pinned: meta.pinned ?? false,
  openedAt: meta.openedAt ?? meta.updatedAt,
  author: meta.author ?? "You",
});

export const getSceneMeta = (id: string) =>
  get<SceneMeta>(metaKey(id), store).then((meta) =>
    meta ? withDefaults(meta) : null,
  );

export const loadSceneData = (id: string) =>
  get<SceneData>(dataKey(id), store).then((data) => data ?? null);

/** every scene, newest edit first (trashed ones included; filter on deletedAt) */
export const listScenes = async () => {
  const metaKeys = (await keys(store)).filter(
    (key): key is string => typeof key === "string" && key.startsWith("meta:"),
  );
  const metas = (await getMany<SceneMeta>(metaKeys, store))
    .filter(Boolean)
    .map(withDefaults);
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
};

const authorName = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    return (stored && JSON.parse(stored).username) || "You";
  } catch {
    return "You";
  }
};

export const createScene = async (
  data: SceneData = { elements: [], appState: {} },
  name = DEFAULT_SCENE_NAME,
  collectionId: string | null = null,
) => {
  const now = Date.now();
  const meta: SceneMeta = {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    thumbnail: null,
    fileIds: fileIdsOf(data.elements),
    elementCount: getNonDeletedElements(data.elements).length,
    deletedAt: null,
    collectionId,
    pinned: false,
    openedAt: now,
    author: authorName(),
  };
  await set(dataKey(meta.id), data, store);
  await set(metaKey(meta.id), meta, store);
  libraryChanged();
  return meta;
};

/**
 * Makes sure there is an active scene. On the very first start the drawing the
 * user already has becomes their first scene, so nothing is lost.
 */
let ensuring: Promise<SceneMeta> | null = null;
export const ensureActiveScene = (current: () => SceneData) => {
  // React runs effects twice in development; don't create two first scenes
  ensuring ??= findOrCreateActiveScene(current).finally(() => {
    ensuring = null;
  });
  return ensuring;
};

const findOrCreateActiveScene = async (
  current: () => SceneData,
): Promise<SceneMeta> => {
  const id = getActiveSceneId();
  const existing = id ? await getSceneMeta(id) : null;
  if (existing && !existing.deletedAt) {
    appJotaiStore.set(activeSceneAtom, {
      id: existing.id,
      name: existing.name,
    });
    return existing;
  }
  const meta = await createScene(current());
  rememberActive(meta);
  return meta;
};

/** writes the working copy into a scene's record */
export const saveScene = async (
  id: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  thumbnail?: string | null,
) => {
  const meta = await getSceneMeta(id);
  if (!meta) {
    return;
  }
  const alive = getNonDeletedElements(elements as ExcalidrawElement[]);
  const data: SceneData = {
    elements: alive as ExcalidrawElement[],
    appState: clearAppStateForLocalStorage(appState),
  };
  const next: SceneMeta = {
    ...meta,
    updatedAt: Date.now(),
    fileIds: fileIdsOf(alive),
    elementCount: alive.length,
    thumbnail: thumbnail === undefined ? meta.thumbnail : thumbnail,
  };
  await set(dataKey(id), data, store);
  await set(metaKey(id), next, store);
};

const updateMeta = async (id: string, patch: Partial<SceneMeta>) => {
  const meta = await getSceneMeta(id);
  if (!meta) {
    return null;
  }
  const next = { ...meta, ...patch };
  await set(metaKey(id), next, store);
  libraryChanged();
  if (id === getActiveSceneId()) {
    appJotaiStore.set(activeSceneAtom, { id, name: next.name });
  }
  return next;
};

export const renameScene = (id: string, name: string) =>
  updateMeta(id, { name: name.trim() || DEFAULT_SCENE_NAME });

export const trashScene = (id: string) =>
  updateMeta(id, { deletedAt: Date.now() });

export const restoreScene = (id: string) => updateMeta(id, { deletedAt: null });

export const deleteScene = async (id: string) => {
  await del(metaKey(id), store);
  await del(dataKey(id), store);
  libraryChanged();
};

export const duplicateScene = async (id: string) => {
  const [meta, data] = await Promise.all([getSceneMeta(id), loadSceneData(id)]);
  if (!meta || !data) {
    return null;
  }
  const copy = await createScene(data, `${meta.name} (copy)`);
  await set(metaKey(copy.id), { ...copy, thumbnail: meta.thumbnail }, store);
  libraryChanged();
  return copy;
};

export const setActiveScene = async (id: string) => {
  const meta = await getSceneMeta(id);
  rememberActive(meta);
  return meta;
};

/** images used by any scene, so the shared image store keeps them */
export const allSceneFileIds = async () => {
  const scenes = await listScenes();
  return new Set(scenes.flatMap((scene) => scene.fileIds));
};

export const moveScene = (id: string, collectionId: string | null) =>
  updateMeta(id, { collectionId });

export const pinScene = (id: string, pinned: boolean) =>
  updateMeta(id, { pinned });

export const markSceneOpened = (id: string) =>
  updateMeta(id, { openedAt: Date.now() });

// ---------------------------------------------------------------------------
// collections: folders for scenes. Scenes without one are in "Private".
// ---------------------------------------------------------------------------

const COLLECTIONS_KEY = "collections";

export const listCollections = () =>
  get<Collection[]>(COLLECTIONS_KEY, store).then((list) => list ?? []);

const saveCollections = async (list: Collection[]) => {
  await set(COLLECTIONS_KEY, list, store);
  libraryChanged();
};

export const createCollection = async (name: string, icon: string) => {
  const collection: Collection = {
    id: newId(),
    name: name.trim() || "New collection",
    icon,
    createdAt: Date.now(),
  };
  await saveCollections([...(await listCollections()), collection]);
  return collection;
};

export const updateCollection = async (
  id: string,
  patch: Partial<Pick<Collection, "name" | "icon">>,
) => {
  const list = await listCollections();
  await saveCollections(
    list.map((collection) =>
      collection.id === id
        ? {
            ...collection,
            ...patch,
            name: (patch.name ?? collection.name).trim() || collection.name,
          }
        : collection,
    ),
  );
};

/** its scenes go back to Private */
export const deleteCollection = async (id: string) => {
  const scenes = await listScenes();
  await Promise.all(
    scenes
      .filter((scene) => scene.collectionId === id)
      .map((scene) => moveScene(scene.id, null)),
  );
  await saveCollections(
    (await listCollections()).filter((collection) => collection.id !== id),
  );
};

export const notifyLibraryChanged = libraryChanged;
