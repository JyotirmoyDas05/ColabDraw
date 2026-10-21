import clsx from "clsx";
import { useState } from "react";

import {
  createCollection,
  renameScene,
  updateCollection,
} from "../data/scenes";

import { EmojiPicker } from "./EmojiPicker";

import "./ScenePrompt.scss";

import type { Collection, SceneMeta } from "../data/scenes";

/** a small dialog for naming a scene or a collection (and choosing its icon) */
export type Prompt =
  | { kind: "renameScene"; scene: SceneMeta }
  | { kind: "newCollection" }
  | { kind: "editCollection"; collection: Collection };

export const PromptDialog = ({
  prompt,
  onClose,
}: {
  prompt: Prompt;
  onClose: () => void;
}) => {
  const isScene = prompt.kind === "renameScene";
  const existing =
    prompt.kind === "renameScene"
      ? prompt.scene.name
      : prompt.kind === "editCollection"
      ? prompt.collection.name
      : "";
  const [name, setName] = useState(existing);
  const [icon, setIcon] = useState(
    prompt.kind === "editCollection" ? prompt.collection.icon : "📁",
  );
  const [pickingIcon, setPickingIcon] = useState(false);

  const title = isScene
    ? "Rename scene"
    : prompt.kind === "newCollection"
    ? "New collection"
    : "Edit collection";

  const submit = async () => {
    if (!name.trim()) {
      return;
    }
    if (prompt.kind === "renameScene") {
      await renameScene(prompt.scene.id, name);
    } else if (prompt.kind === "newCollection") {
      await createCollection(name, icon);
    } else {
      await updateCollection(prompt.collection.id, { name, icon });
    }
    onClose();
  };

  return (
    <div
      className="colab-prompt__scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="colab-prompt__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>{title}</h2>
        {!isScene && (
          <>
            <span className="colab-prompt__label">Icon</span>
            <button
              type="button"
              className={clsx("colab-prompt__icon-field", {
                "is-open": pickingIcon,
              })}
              aria-expanded={pickingIcon}
              onClick={() => setPickingIcon(!pickingIcon)}
            >
              <span className="colab-prompt__emoji">{icon}</span>
              {pickingIcon ? "Hide icons" : "Choose an icon"}
            </button>
            {pickingIcon && (
              <EmojiPicker
                value={icon}
                onChange={(emoji) => {
                  setIcon(emoji);
                  setPickingIcon(false);
                }}
              />
            )}
          </>
        )}
        <label className="colab-prompt__label" htmlFor="dashboard-name">
          {isScene ? "Scene name" : "Collection name"}
        </label>
        <input
          id="dashboard-name"
          value={name}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          maxLength={80}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="colab-prompt__actions">
          <button type="button" className="is-text" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="is-primary" disabled={!name.trim()}>
            {isScene ? "Rename scene" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
};
