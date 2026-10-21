import { ColabDrawLogoIcon } from "@excalidraw/excalidraw/components/ColabDrawLogo";

import "./BrandMark.scss";

/** the ColabDraw pencil-and-hand icon with the wordmark beside it */
export const BrandMark = () => (
  <span className="colab-brand">
    <ColabDrawLogoIcon />
    <img
      src="/colabdraw-wordmark.svg"
      alt="ColabDraw"
      draggable={false}
      height={22}
    />
  </span>
);
