import {
  DotsIcon,
  PlusIcon,
  TrashIcon,
  searchIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { atom, useAtomValue, useSetAtom } from "../app-jotai";
import {
  activeSceneAtom,
  deleteCollection,
  deleteScene,
  getActiveSceneId,
  moveScene,
  pinScene,
  trashScene,
} from "../data/scenes";
import {
  importSceneFiles,
  openNewScene,
  openScene,
  snapshotActiveScene,
} from "../data/sceneActions";

import {
  CloseIcon,
  GridIcon,
  ImportIcon,
  LockIcon,
  NewSceneIcon,
  PinIcon,
  SortIcon,
} from "./dashboardIcons";
import { BrandMark } from "./BrandMark";
import { PromptDialog } from "./ScenePrompt";
import { useSceneActions } from "./SceneActions";
import { useSceneLibrary } from "./useSceneLibrary";

import "./Dashboard.scss";

import type { Prompt } from "./ScenePrompt";
import type { Collection, SceneMeta } from "../data/scenes";

export const dashboardOpenAtom = atom(false);

/** where the dashboard is looking: home, a collection (null = Private) or trash */
type View =
  | { kind: "home" }
  | { kind: "collection"; id: string | null }
  | { kind: "trash" };

type Sort = "created" | "edited" | "name";

const DRAG_TYPE = "application/x-colabdraw-scene";

const PRIVATE_DESCRIPTION =
  "Your default collection. Scenes are saved in this browser and nobody else can see them.";

const rtf = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
  style: "short",
});

export const timeAgo = (time: number) => {
  const seconds = Math.round((time - Date.now()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

export const sortScenes = (scenes: SceneMeta[], sort: Sort) =>
  [...scenes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "edited"
      ? b.updatedAt - a.updatedAt
      : b.createdAt - a.createdAt;
  });

// ---------------------------------------------------------------------------
// scene card
// ---------------------------------------------------------------------------

const SceneCard = ({
  scene,
  collections,
  isCurrent,
  inTrash,
  disabled,
  onOpen,
  onRename,
  onTrash,
}: {
  scene: SceneMeta;
  collections: Collection[];
  isCurrent: boolean;
  inTrash: boolean;
  /** opening is off while a live session is running */
  disabled: boolean;
  onOpen: (id: string) => void;
  onRename: (scene: SceneMeta) => void;
  onTrash: (scene: SceneMeta) => void;
}) => {
  const actions = useSceneActions({
    scene,
    collections,
    inTrash,
    onRename,
    onTrash,
  });

  return (
    <article
      className={clsx("colab-dashboard__card", {
        "colab-dashboard__card--current": isCurrent,
        "colab-actions-open": actions.open,
      })}
      draggable={!inTrash}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, scene.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onContextMenu={actions.onContextMenu}
    >
      <button
        type="button"
        className="colab-dashboard__thumb"
        disabled={inTrash || disabled}
        aria-label={`Open ${scene.name}`}
        onClick={() => onOpen(scene.id)}
      >
        {scene.thumbnail && (
          <img src={scene.thumbnail} alt="" draggable={false} />
        )}
        <span className="colab-dashboard__time">
          {inTrash && scene.deletedAt
            ? `deleted ${timeAgo(scene.deletedAt)}`
            : timeAgo(scene.updatedAt)}
        </span>
      </button>

      {actions.hover}
      {actions.menu}

      <div className="colab-dashboard__meta">
        <div className="colab-dashboard__meta-text">
          <h3 title={scene.name}>{scene.name}</h3>
          <p>by {scene.author}</p>
        </div>
        {scene.pinned && !inTrash && (
          <button
            type="button"
            className="colab-dashboard__pin is-pinned"
            aria-label="Unpin scene"
            title="Pinned. Click to unpin"
            onClick={() => pinScene(scene.id, false)}
          >
            {PinIcon}
          </button>
        )}
        {!scene.collectionId && !inTrash && (
          <span className="colab-dashboard__lock" title="Private">
            {LockIcon}
          </span>
        )}
      </div>
    </article>
  );
};

// ---------------------------------------------------------------------------
// the dashboard
// ---------------------------------------------------------------------------

/** Every scene in this browser, organised in collections, in the style of Excalidraw Plus. */
export const Dashboard = ({
  excalidrawAPI,
  isCollaborating,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  isCollaborating: boolean;
}) => {
  const open = useAtomValue(dashboardOpenAtom);
  const setOpen = useSetAtom(dashboardOpenAtom);
  const active = useAtomValue(activeSceneAtom);
  const { scenes, collections } = useSceneLibrary(open);

  const [view, setView] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("created");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(
    undefined,
  );
  const [collectionMenu, setCollectionMenu] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !excalidrawAPI) {
      return;
    }
    // the open scene's card should show what's on the canvas right now
    snapshotActiveScene(excalidrawAPI).catch(console.error);
  }, [open, excalidrawAPI]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !prompt) {
        setOpen(false);
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, prompt, setOpen]);

  useEffect(() => {
    if (collectionMenu === null) {
      return;
    }
    const close = () => setCollectionMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [collectionMenu]);

  const alive = useMemo(() => scenes.filter((s) => !s.deletedAt), [scenes]);
  const trashed = useMemo(() => scenes.filter((s) => s.deletedAt), [scenes]);
  const activeId = active?.id ?? getActiveSceneId();

  if (!open) {
    return null;
  }

  const collectionOf = (id: string | null) =>
    id ? collections.find((c) => c.id === id) ?? null : null;

  // a deleted collection leaves the view on a collection that is gone
  const effectiveView: View =
    view.kind === "collection" && view.id && !collectionOf(view.id)
      ? { kind: "collection", id: null }
      : view;

  const run = async (action: () => Promise<unknown>) => {
    if (!excalidrawAPI || busy) {
      return;
    }
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const openExisting = (id: string) =>
    run(async () => {
      await openScene(excalidrawAPI!, id);
      setOpen(false);
    });

  const create = (collectionId: string | null) =>
    run(async () => {
      await openNewScene(excalidrawAPI!, collectionId);
      setOpen(false);
    });

  // the open scene can't stay open once it is in the trash: carry on elsewhere
  const trash = async (scene: SceneMeta) => {
    await trashScene(scene.id);
    if (scene.id === getActiveSceneId()) {
      const next = alive.find((s) => s.id !== scene.id);
      await run(() =>
        next
          ? openScene(excalidrawAPI!, next.id)
          : openNewScene(excalidrawAPI!),
      );
    }
  };

  const emptyTrash = async () => {
    if (
      trashed.length &&
      window.confirm(
        `Delete ${trashed.length} scene${
          trashed.length === 1 ? "" : "s"
        } forever? This can't be undone.`,
      )
    ) {
      await Promise.all(trashed.map((s) => deleteScene(s.id)));
    }
  };

  const onImport = async (files: FileList | null) => {
    if (!files?.length || effectiveView.kind !== "collection") {
      return;
    }
    const count = await importSceneFiles([...files], effectiveView.id);
    if (!count) {
      window.alert("Those files couldn't be imported as scenes.");
    }
    if (importRef.current) {
      importRef.current.value = "";
    }
  };

  const dropProps = (collectionId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (event.dataTransfer.types.includes(DRAG_TYPE)) {
        event.preventDefault();
        setDropTarget(collectionId);
      }
    },
    onDragLeave: () => setDropTarget(undefined),
    onDrop: async (event: React.DragEvent) => {
      event.preventDefault();
      setDropTarget(undefined);
      const id = event.dataTransfer.getData(DRAG_TYPE);
      if (id) {
        await moveScene(id, collectionId);
      }
    },
  });

  const card = (scene: SceneMeta, inTrash = false) => (
    <SceneCard
      key={scene.id}
      scene={scene}
      collections={collections}
      isCurrent={scene.id === activeId && !inTrash}
      inTrash={inTrash}
      disabled={busy || isCollaborating}
      onOpen={openExisting}
      onRename={(s) => setPrompt({ kind: "renameScene", scene: s })}
      onTrash={trash}
    />
  );

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  const username = (() => {
    try {
      const stored = localStorage.getItem("excalidraw-collab");
      return (stored && JSON.parse(stored).username) || "You";
    } catch {
      return "You";
    }
  })();

  const heading = (() => {
    if (searching) {
      return { icon: searchIcon, title: `Results for "${query.trim()}"` };
    }
    if (effectiveView.kind === "home") {
      return { icon: GridIcon, title: "Dashboard" };
    }
    if (effectiveView.kind === "trash") {
      return { icon: TrashIcon, title: "Trash" };
    }
    const collection = collectionOf(effectiveView.id);
    return collection
      ? {
          icon: (
            <span className="colab-dashboard__emoji">{collection.icon}</span>
          ),
          title: collection.name,
        }
      : { icon: LockIcon, title: "Private" };
  })();

  const collectionScenes =
    effectiveView.kind === "collection"
      ? sortScenes(
          alive.filter((s) => s.collectionId === effectiveView.id),
          sort,
        )
      : [];

  return (
    <div
      className="colab-dashboard"
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard"
    >
      <aside className="colab-dashboard__nav">
        <div className="colab-dashboard__brand">
          <BrandMark />
          <span>Saved in this browser</span>
        </div>

        <label className="colab-dashboard__search">
          {searchIcon}
          <input
            ref={searchRef}
            type="search"
            placeholder="Quick search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Ctrl P</kbd>
        </label>

        <button
          type="button"
          className={clsx("colab-dashboard__nav-item", {
            "is-active": !searching && effectiveView.kind === "home",
          })}
          onClick={() => {
            setQuery("");
            setView({ kind: "home" });
          }}
        >
          {GridIcon} Dashboard
        </button>

        <div className="colab-dashboard__section">
          <h2>Collections</h2>
          <button
            type="button"
            className="colab-dashboard__add"
            aria-label="New collection"
            onClick={() => setPrompt({ kind: "newCollection" })}
          >
            {PlusIcon}
          </button>
        </div>

        <div className="colab-dashboard__collections">
          <button
            type="button"
            className={clsx("colab-dashboard__nav-item", {
              "is-active":
                !searching &&
                effectiveView.kind === "collection" &&
                effectiveView.id === null,
              "is-drop": dropTarget === null,
            })}
            onClick={() => {
              setQuery("");
              setView({ kind: "collection", id: null });
            }}
            {...dropProps(null)}
          >
            {LockIcon} Private
          </button>
          <hr />
          {collections.map((collection) => (
            <div
              key={collection.id}
              className={clsx("colab-dashboard__nav-row", {
                "is-active":
                  !searching &&
                  effectiveView.kind === "collection" &&
                  effectiveView.id === collection.id,
                "is-drop": dropTarget === collection.id,
              })}
              {...dropProps(collection.id)}
            >
              <button
                type="button"
                className="colab-dashboard__nav-item"
                onClick={() => {
                  setQuery("");
                  setView({ kind: "collection", id: collection.id });
                }}
              >
                <span className="colab-dashboard__emoji">
                  {collection.icon}
                </span>
                <span className="colab-dashboard__ellipsis">
                  {collection.name}
                </span>
              </button>
              <div
                className="colab-dashboard__menu colab-dashboard__menu--row"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="colab-dashboard__dots"
                  aria-label={`Options for ${collection.name}`}
                  onClick={() =>
                    setCollectionMenu(
                      collectionMenu === collection.id ? null : collection.id,
                    )
                  }
                >
                  {DotsIcon}
                </button>
                {collectionMenu === collection.id && (
                  <div className="colab-dashboard__popover" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCollectionMenu(null);
                        setPrompt({ kind: "editCollection", collection });
                      }}
                    >
                      {pencilIcon} Edit
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="colab-dashboard__danger"
                      onClick={() => {
                        setCollectionMenu(null);
                        if (
                          window.confirm(
                            `Delete the collection "${collection.name}"? Its scenes move back to Private.`,
                          )
                        ) {
                          deleteCollection(collection.id);
                        }
                      }}
                    >
                      {TrashIcon} Delete collection
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <hr />
          <button
            type="button"
            className={clsx("colab-dashboard__nav-item", {
              "is-active": !searching && effectiveView.kind === "trash",
            })}
            onClick={() => {
              setQuery("");
              setView({ kind: "trash" });
            }}
          >
            {TrashIcon} Trash <em>{trashed.length || ""}</em>
          </button>
        </div>

        <div className="colab-dashboard__user">
          <span className="colab-dashboard__avatar colab-dashboard__avatar--user">
            {username.slice(0, 1).toUpperCase()}
          </span>
          <strong>{username}</strong>
        </div>
      </aside>

      <main className="colab-dashboard__main">
        <header>
          <div className="colab-dashboard__title">
            <h1>
              {heading.icon}
              {heading.title}
            </h1>
            {!searching && effectiveView.kind === "collection" && (
              <p>
                {effectiveView.id === null
                  ? `${PRIVATE_DESCRIPTION} Drag a scene to a different collection to organise it.`
                  : "Drag a scene here from another collection to add it."}
              </p>
            )}
            {!searching && effectiveView.kind === "trash" && (
              <p>Scenes you delete stay here until you delete them forever.</p>
            )}
          </div>
          <div className="colab-dashboard__tools">
            {!searching && effectiveView.kind === "collection" && (
              <label className="colab-dashboard__sort">
                <select
                  aria-label="Sort scenes"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="created">Last created</option>
                  <option value="edited">Last edited</option>
                  <option value="name">Name</option>
                </select>
                {SortIcon}
              </label>
            )}
            {!searching && effectiveView.kind === "home" && (
              <button
                type="button"
                className="colab-dashboard__primary"
                onClick={() => setOpen(false)}
              >
                {pencilIcon} Start drawing
              </button>
            )}
            {!searching && effectiveView.kind === "trash" && (
              <button
                type="button"
                className="colab-dashboard__secondary"
                disabled={!trashed.length}
                onClick={emptyTrash}
              >
                Empty trash
              </button>
            )}
            <button
              type="button"
              className="colab-dashboard__close"
              aria-label="Back to the board"
              title="Close (Esc)"
              onClick={() => setOpen(false)}
            >
              {CloseIcon}
            </button>
          </div>
        </header>

        {isCollaborating && (
          <p className="colab-dashboard__banner">
            You're in a live session. Leave it to switch scenes or start a new
            one.
          </p>
        )}

        {searching ? (
          (() => {
            const found = alive.filter((s) =>
              s.name.toLowerCase().includes(needle),
            );
            return found.length ? (
              <div className="colab-dashboard__grid">
                {sortScenes(found, "edited").map((s) => card(s))}
              </div>
            ) : (
              <div className="colab-dashboard__empty">
                No scenes match your search.
              </div>
            );
          })()
        ) : effectiveView.kind === "home" ? (
          <>
            <h2 className="colab-dashboard__heading">
              Recently modified by you
            </h2>
            {alive.length ? (
              <div className="colab-dashboard__grid">
                {[...alive]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .slice(0, 4)
                  .map((s) => card(s))}
              </div>
            ) : (
              <div className="colab-dashboard__empty">No scenes yet.</div>
            )}
            <h2 className="colab-dashboard__heading">
              Recently visited by you
            </h2>
            <div className="colab-dashboard__grid">
              {[...alive]
                .sort((a, b) => b.openedAt - a.openedAt)
                .slice(0, 4)
                .map((s) => card(s))}
            </div>
          </>
        ) : effectiveView.kind === "trash" ? (
          trashed.length ? (
            <div className="colab-dashboard__grid">
              {trashed.map((s) => card(s, true))}
            </div>
          ) : (
            <div className="colab-dashboard__empty">Trash is empty.</div>
          )
        ) : (
          <>
            <div className="colab-dashboard__actions">
              <button
                type="button"
                className="colab-dashboard__action"
                onClick={() => importRef.current?.click()}
              >
                <span className="colab-dashboard__action-icon">
                  {ImportIcon}
                </span>
                Import scenes
                <span className="colab-dashboard__action-plus">{PlusIcon}</span>
              </button>
              <button
                type="button"
                className="colab-dashboard__action"
                disabled={busy || isCollaborating}
                onClick={() => create(effectiveView.id)}
              >
                <span className="colab-dashboard__action-icon">
                  {NewSceneIcon}
                </span>
                Create scene
                <span className="colab-dashboard__action-plus">{PlusIcon}</span>
              </button>
              <input
                ref={importRef}
                type="file"
                hidden
                multiple
                accept=".excalidraw,.json,application/json"
                onChange={(event) => onImport(event.target.files)}
              />
            </div>
            {collectionScenes.length ? (
              <div className="colab-dashboard__grid">
                {collectionScenes.map((s) => card(s))}
              </div>
            ) : (
              <div className="colab-dashboard__empty">
                No scenes in this collection yet.
              </div>
            )}
          </>
        )}
      </main>

      {prompt && (
        <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
      )}
    </div>
  );
};
