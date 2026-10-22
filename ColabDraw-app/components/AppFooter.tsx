import React from "react";
import { Footer, FooterLeft } from "@excalidraw/excalidraw/index";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PresentationFooterButton } from "../presentation/PresentationFooterButton";

import { DebugFooter, isVisualDebuggerEnabled } from "./DebugCanvas";
import { EncryptedIcon } from "./EncryptedIcon";

export const AppFooter = React.memo(
  ({
    onChange,
    excalidrawAPI,
    onStartPresentation,
  }: {
    onChange: () => void;
    excalidrawAPI?: ExcalidrawImperativeAPI | null;
    onStartPresentation?: () => void;
  }) => {
    return (
      <>
        <FooterLeft>
          <PresentationFooterButton
            excalidrawAPI={excalidrawAPI}
            onStartPresentation={onStartPresentation}
          />
        </FooterLeft>
        <Footer>
          <div
            style={{
              display: "flex",
              gap: ".5rem",
              alignItems: "center",
            }}
          >
            {isVisualDebuggerEnabled() && <DebugFooter onChange={onChange} />}
            <EncryptedIcon />
          </div>
        </Footer>
      </>
    );
  },
);
