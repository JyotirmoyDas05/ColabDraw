import clsx from "clsx";
import React from "react";

import { useTunnels } from "../../context/tunnels";
import { useUIAppState } from "../../context/ui-appState";

export const FooterLeft = ({ children }: { children?: React.ReactNode }) => {
  const { FooterLeftTunnel } = useTunnels();
  const appState = useUIAppState();
  return (
    <FooterLeftTunnel.In>
      <div
        className={clsx("footer-left-extra zen-mode-transition", {
          "layer-ui__wrapper__footer-left--transition-bottom":
            appState.zenModeEnabled,
        })}
      >
        {children}
      </div>
    </FooterLeftTunnel.In>
  );
};

export default FooterLeft;
FooterLeft.displayName = "FooterLeft";
