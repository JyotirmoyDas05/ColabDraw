import {
  DotsIcon,
  DuplicateIcon,
  RetryIcon,
  TrashIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import {
  deleteScene,
  duplicateScene,
  moveScene,
  pinScene,
  restoreScene,
} from "../data/scenes";
import { exportSceneFile } from "../data/sceneActions";

import { DownloadIcon, LockIcon, PinIcon } from "./dashboardIcons";

import "./SceneActions.scss";

import type { Collection, SceneMeta } from "../data/scenes";

type MenuPlace = null | "dots" | { x: number; y: number };

/**
 * The hover buttons (delete, three dots), the menu they open and the right
 * click menu, shared by the dashboard's cards and the sidebar's rows. The
 * caller puts `hover` and `menu` inside a `position: relative` box, wires
 * `onContextMenu` on it and adds the `colab-actions-open` class while `open`.
 */
export const useSceneActions = ({
  scene,
  collections,
  inTrash,
  compact = false,
  onRename,
  onTrash,
}: {
  scene: SceneMeta;
  collections: Collection[];
  inTrash: boolean;
  compact?: boolean;
  onRename: (scene: SceneMeta) => void;
  onTrash: (scene: SceneMeta) => void;
}) => {
  const [place, setPlace] = useState<MenuPlace>(null);
  const [confirming, setConfirming] = useState<"hover" | "menu" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!place) {
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      // the dots button toggles the menu itself; closing here too would reopen it
      if (
        menuRef.current?.contains(target) ||
        hoverRef.current?.contains(target)
      ) {
        return;
      }
      setPlace(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPlace(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [place]);

  // a delete asks twice; waiting 3 seconds cancels it
  useEffect(() => {
    if (!confirming) {
      return;
    }
    const timer = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  useEffect(() => {
    if (!place) {
      setConfirming((current) => (current === "menu" ? null : current));
    }
  }, [place]);

  const act = (action: () => Promise<unknown> | void) => () => {
    setPlace(null);
    action();
  };

  const remove = () => {
    setConfirming(null);
    setPlace(null);
    if (inTrash) {
      deleteScene(scene.id);
    } else {
      onTrash(scene);
    }
  };

  const deleteLabel = inTrash ? "Delete forever" : "Delete";

  const deleteItem = (
    <button
      type="button"
      role="menuitem"
      className="colab-actions__danger"
      onClick={() => (confirming === "menu" ? remove() : setConfirming("menu"))}
    >
      {TrashIcon}{" "}
      {confirming === "menu" ? "Click again to delete" : deleteLabel}
    </button>
  );

  const hover = (
    <div
      ref={hoverRef}
      className={clsx("colab-actions__hover", {
        "colab-actions__hover--compact": compact,
      })}
      onMouseLeave={() => setConfirming((c) => (c === "hover" ? null : c))}
    >
      <button
        type="button"
        className={clsx("colab-actions__delete", {
          "is-confirming": confirming === "hover",
        })}
        aria-label={
          confirming === "hover"
            ? `Click again to delete ${scene.name}`
            : `${deleteLabel} ${scene.name}`
        }
        title={confirming === "hover" ? "Click again to delete" : deleteLabel}
        onClick={() =>
          confirming === "hover" ? remove() : setConfirming("hover")
        }
      >
        {TrashIcon}
        {confirming === "hover" && <span>Sure?</span>}
      </button>
      <button
        type="button"
        className="colab-actions__dots"
        aria-label={`Options for ${scene.name}`}
        aria-expanded={place === "dots"}
        onClick={() => setPlace(place === "dots" ? null : "dots")}
      >
        {DotsIcon}
      </button>
    </div>
  );

  const menu = place && (
    <div
      ref={menuRef}
      className={clsx("colab-actions__popover", {
        "colab-actions__popover--fixed": place !== "dots",
        "colab-actions__popover--compact": compact,
      })}
      style={
        place !== "dots"
          ? {
              left: Math.min(place.x, window.innerWidth - 230),
              top: Math.min(place.y, window.innerHeight - 360),
            }
          : undefined
      }
      role="menu"
    >
      {inTrash ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={act(() => restoreScene(scene.id))}
          >
            {RetryIcon} Restore
          </button>
          {deleteItem}
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={act(() => onRename(scene))}
          >
            {pencilIcon} Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={act(() => pinScene(scene.id, !scene.pinned))}
          >
            {PinIcon} {scene.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={act(() => duplicateScene(scene.id))}
          >
            {DuplicateIcon} Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={act(() => exportSceneFile(scene.id))}
          >
            {DownloadIcon} Download
          </button>
          {(collections.length > 0 || scene.collectionId) && (
            <>
              <span className="colab-actions__label">Move to</span>
              {scene.collectionId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={act(() => moveScene(scene.id, null))}
                >
                  {LockIcon} Private
                </button>
              )}
              {collections
                .filter((c) => c.id !== scene.collectionId)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitem"
                    onClick={act(() => moveScene(scene.id, c.id))}
                  >
                    <span className="colab-actions__emoji">{c.icon}</span>{" "}
                    {c.name}
                  </button>
                ))}
            </>
          )}
          {deleteItem}
        </>
      )}
    </div>
  );

  return {
    hover,
    menu,
    open: !!place || !!confirming,
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      setPlace({ x: event.clientX, y: event.clientY });
    },
  };
};
