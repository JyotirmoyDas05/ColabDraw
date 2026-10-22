import React from "react";
import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import { presentationIcon } from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PresentationSidebarTab } from "./PresentationSidebarTab";

import "./AppSidebar.scss";

interface AppSidebarProps {
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  onStartPresentation?: (startIndex?: number, isLive?: boolean) => void;
  isCollaborating?: boolean;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  excalidrawAPI = null,
  onStartPresentation = () => {},
  isCollaborating = false,
}) => {
  return (
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        <Sidebar.TabTrigger tab="presentation" title="Presentation">
          {presentationIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      <Sidebar.Tab tab="presentation">
        <PresentationSidebarTab
          excalidrawAPI={excalidrawAPI}
          onStartPresentation={onStartPresentation}
          isCollaborating={isCollaborating}
        />
      </Sidebar.Tab>
    </DefaultSidebar>
  );
};
