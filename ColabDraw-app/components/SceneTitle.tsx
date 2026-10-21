import { useState } from "react";

import { useAtom, useAtomValue } from "../app-jotai";
import { activeSceneAtom, renameScene } from "../data/scenes";

import { SidebarCloseIcon, SidebarIcon } from "./dashboardIcons";
import { sceneSidebarOpenAtom } from "./SceneSidebar";

import "./SceneTitle.scss";

/** top left: the button for the scene sidebar, and the open scene's name (click to rename) */
export const SceneTitle = () => {
  const active = useAtomValue(activeSceneAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sceneSidebarOpenAtom);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!active) {
    return null;
  }

  const finish = async () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== active.name) {
      await renameScene(active.id, draft);
    }
  };

  return (
    <>
      <button
        type="button"
        className="colab-scene-button dropdown-menu-button main-menu-trigger"
        aria-label={sidebarOpen ? "Close the sidebar" : "Open the sidebar"}
        aria-pressed={sidebarOpen}
        title={sidebarOpen ? "Close the sidebar" : "Open the sidebar"}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? SidebarCloseIcon : SidebarIcon}
      </button>
      <div className="colab-scene-name">
        {editing ? (
          <input
            value={draft}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            maxLength={80}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={finish}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                finish();
              } else if (event.key === "Escape") {
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            title="Rename scene"
            onClick={() => {
              setDraft(active.name);
              setEditing(true);
            }}
          >
            {active.name}
          </button>
        )}
      </div>
    </>
  );
};
