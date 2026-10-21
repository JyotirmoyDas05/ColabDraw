import { PlusIcon, searchIcon } from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { atom, useAtomValue, useSetAtom } from "../app-jotai";
import { openNewScene, openScene } from "../data/sceneActions";
import { activeSceneAtom, trashScene } from "../data/scenes";

import { BrandMark } from "./BrandMark";
import { dashboardOpenAtom, sortScenes, timeAgo } from "./Dashboard";
import {
  ChevronLeftIcon,
  GridIcon,
  LockIcon,
  PinIcon,
  SortIcon,
} from "./dashboardIcons";
import { useSceneActions } from "./SceneActions";
import { PromptDialog } from "./ScenePrompt";
import { useSceneLibrary } from "./useSceneLibrary";

import "./SceneSidebar.scss";

import type { Prompt } from "./ScenePrompt";
import type { Collection, SceneMeta } from "../data/scenes";

export const sceneSidebarOpenAtom = atom(false);

type Sort = "created" | "edited" | "name";
const SORTS: Sort[] = ["created", "edited", "name"];
const SORT_LABELS: Record<Sort, string> = {
  created: "Last created",
  edited: "Last edited",
  name: "Name",
};

const readUsername = () => {
  try {
    const stored = localStorage.getItem("excalidraw-collab");
    return (stored && JSON.parse(stored).username) || "You";
  } catch {
    return "You";
  }
};

const SidebarRow = ({
  scene,
  collections,
  isActive,
  disabled,
  onOpen,
  onRename,
  onTrash,
}: {
  scene: SceneMeta;
  collections: Collection[];
  isActive: boolean;
  disabled: boolean;
  onOpen: (id: string) => void;
  onRename: (scene: SceneMeta) => void;
  onTrash: (scene: SceneMeta) => void;
}) => {
  const actions = useSceneActions({
    scene,
    collections,
    inTrash: false,
    compact: true,
    onRename,
    onTrash,
  });

  return (
    <li
      className={clsx("colab-scene-sidebar__item", {
        "colab-actions-open": actions.open,
      })}
      onContextMenu={actions.onContextMenu}
    >
      <button
        type="button"
        className={clsx("colab-scene-sidebar__row", { "is-active": isActive })}
        disabled={disabled}
        onClick={() => onOpen(scene.id)}
      >
        <span className="colab-scene-sidebar__thumb">
          {scene.thumbnail && (
            <img src={scene.thumbnail} alt="" draggable={false} />
          )}
        </span>
        <span className="colab-scene-sidebar__text">
          <strong>
            {scene.name}
            {scene.pinned && (
              <span className="colab-scene-sidebar__pin" title="Pinned">
                {PinIcon}
              </span>
            )}
          </strong>
          <span>by {scene.author}</span>
          <span>{timeAgo(scene.updatedAt)}</span>
        </span>
      </button>
      {actions.hover}
      {actions.menu}
    </li>
  );
};

/**
 * Docked on the left of the editor, like Excalidraw Plus: a Dashboard tab,
 * quick search, and the scenes of one collection (the back arrow lists all
 * collections).
 */
export const SceneSidebar = ({
  excalidrawAPI,
  isCollaborating,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  isCollaborating: boolean;
}) => {
  const open = useAtomValue(sceneSidebarOpenAtom);
  const openDashboard = useSetAtom(dashboardOpenAtom);
  const active = useAtomValue(activeSceneAtom);
  const { scenes, collections } = useSceneLibrary(open);
  const [sort, setSort] = useState<Sort>("created");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // undefined: follow the collection of the open scene
  const [browsing, setBrowsing] = useState<string | null | undefined>(
    undefined,
  );
  const [listing, setListing] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  if (!open) {
    return null;
  }

  const alive = scenes.filter((scene) => !scene.deletedAt);
  const current = alive.find((scene) => scene.id === active?.id);
  const collectionId =
    browsing !== undefined ? browsing : current?.collectionId ?? null;
  const collection = collections.find((c) => c.id === collectionId);
  const needle = query.trim().toLowerCase();
  const list: SceneMeta[] = needle
    ? sortScenes(
        alive.filter((s) => s.name.toLowerCase().includes(needle)),
        "edited",
      )
    : sortScenes(
        alive.filter((s) => s.collectionId === collectionId),
        sort,
      );
  const username = readUsername();

  const run = async (action: () => Promise<unknown>) => {
    if (!excalidrawAPI || busy || isCollaborating) {
      return;
    }
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  // the open scene can't stay open once it is in the trash: carry on elsewhere
  const trash = async (scene: SceneMeta) => {
    await trashScene(scene.id);
    if (scene.id === active?.id) {
      const next = alive.find((s) => s.id !== scene.id);
      await run(() =>
        next
          ? openScene(excalidrawAPI!, next.id)
          : openNewScene(excalidrawAPI!),
      );
    }
  };

  const countIn = (id: string | null) =>
    alive.filter((s) => s.collectionId === id).length;

  return (
    <aside className="colab-scene-sidebar" aria-label="Scenes">
      <div className="colab-scene-sidebar__brand">
        <BrandMark />
      </div>

      <label className="colab-scene-sidebar__search">
        {searchIcon}
        <input
          type="search"
          placeholder="Quick search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="colab-scene-sidebar__tab"
        onClick={() => openDashboard(true)}
      >
        {GridIcon} Dashboard
      </button>

      {listing && !needle ? (
        <>
          <div className="colab-scene-sidebar__heading">
            <h2>Collections</h2>
          </div>
          <ul className="colab-scene-sidebar__list">
            {[{ id: null, icon: null, name: "Private" }, ...collections].map(
              (entry) => (
                <li key={entry.id ?? "private"}>
                  <button
                    type="button"
                    className={clsx("colab-scene-sidebar__collection", {
                      "is-active": entry.id === collectionId,
                    })}
                    onClick={() => {
                      setBrowsing(entry.id);
                      setListing(false);
                    }}
                  >
                    <span className="colab-scene-sidebar__collection-icon">
                      {entry.icon ?? LockIcon}
                    </span>
                    {entry.name}
                    <em>{countIn(entry.id) || ""}</em>
                  </button>
                </li>
              ),
            )}
          </ul>
        </>
      ) : (
        <>
          <div className="colab-scene-sidebar__heading">
            {!needle && (
              <button
                type="button"
                className="colab-scene-sidebar__icon"
                aria-label="All collections"
                title="All collections"
                onClick={() => setListing(true)}
              >
                {ChevronLeftIcon}
              </button>
            )}
            <h2
              title={needle ? "Search results" : collection?.name ?? "Private"}
            >
              {!needle && (
                <span className="colab-scene-sidebar__collection-icon">
                  {collection ? collection.icon : LockIcon}
                </span>
              )}
              {needle ? "Search results" : collection?.name ?? "Private"}
            </h2>
            {!needle && (
              <>
                <button
                  type="button"
                  className="colab-scene-sidebar__icon"
                  aria-label={`Sorted by ${SORT_LABELS[sort]}. Change sorting`}
                  title={SORT_LABELS[sort]}
                  onClick={() =>
                    setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length])
                  }
                >
                  {SortIcon}
                </button>
                <button
                  type="button"
                  className="colab-scene-sidebar__add"
                  aria-label="New scene"
                  title="New scene"
                  disabled={busy || isCollaborating}
                  onClick={() =>
                    run(() => openNewScene(excalidrawAPI!, collectionId))
                  }
                >
                  {PlusIcon}
                </button>
              </>
            )}
          </div>

          {isCollaborating && (
            <p className="colab-scene-sidebar__note">
              Leave the live session to switch scenes.
            </p>
          )}

          <ul className="colab-scene-sidebar__list">
            {list.map((scene) => (
              <SidebarRow
                key={scene.id}
                scene={scene}
                collections={collections}
                isActive={scene.id === active?.id}
                disabled={busy || isCollaborating}
                onOpen={(id) => run(() => openScene(excalidrawAPI!, id))}
                onRename={(target) =>
                  setPrompt({ kind: "renameScene", scene: target })
                }
                onTrash={trash}
              />
            ))}
            {!list.length && (
              <li className="colab-scene-sidebar__empty">
                {needle ? "No scenes match." : "No scenes here yet."}
              </li>
            )}
          </ul>
        </>
      )}

      {prompt && (
        <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
      )}

      <div className="colab-scene-sidebar__user">
        <span className="colab-scene-sidebar__avatar colab-scene-sidebar__avatar--user">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <strong>{username}</strong>
      </div>
    </aside>
  );
};
