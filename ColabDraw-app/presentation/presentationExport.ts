import { getNonDeletedElements } from "@excalidraw/element";

import { exportToCanvas } from "@excalidraw/excalidraw";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
// eslint-disable-next-line no-restricted-imports

export interface ExportProgress {
  current: number;
  total: number;
  format: "pdf" | "pptx";
}

/**
 * Renders an Excalidraw frame and its contained child elements onto an offscreen canvas.
 */
async function renderFrameToCanvas(
  slide: ExcalidrawFrameLikeElement,
  excalidrawAPI: ExcalidrawImperativeAPI,
): Promise<HTMLCanvasElement> {
  const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
  const appState = excalidrawAPI.getAppState();
  const isDark = appState.theme === "dark";

  // Elements contained inside this frame
  const frameChildren = elements.filter(
    (el) => !el.isDeleted && el.frameId === slide.id,
  );

  const renderElements = [slide, ...frameChildren];
  const files = excalidrawAPI.getFiles() || {};

  const canvas = await exportToCanvas({
    elements: getNonDeletedElements(renderElements),
    appState: {
      ...appState,
      exportBackground: true,
      viewBackgroundColor:
        appState.viewBackgroundColor || (isDark ? "#121212" : "#ffffff"),
      exportWithDarkMode: isDark,
    },
    files,
    exportingFrame: slide as NonDeleted<ExcalidrawFrameLikeElement>,
    exportPadding: 0,
  });

  return canvas;
}

/**
 * Lazy-loads jsPDF and exports all presentation slides as a multi-page PDF document,
 * where each slide frame becomes a dedicated page matching the frame's exact aspect ratio.
 */
export async function exportPresentationToPdf({
  excalidrawAPI,
  slides,
  onProgress,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  slides: readonly ExcalidrawFrameLikeElement[];
  onProgress?: (progress: ExportProgress) => void;
}): Promise<void> {
  if (!slides.length) {
    throw new Error("No presentation slides to export.");
  }

  // Lazy-load jsPDF so bundle remains lean
  const { jsPDF } = await import("jspdf");

  const appState = excalidrawAPI.getAppState();
  const sceneName = (appState.name?.trim() || "presentation").replace(
    /[\\/:*?"<>|]/g,
    "_",
  );

  let doc: InstanceType<typeof jsPDF> | null = null;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    onProgress?.({ current: i + 1, total: slides.length, format: "pdf" });

    const canvas = await renderFrameToCanvas(slide, excalidrawAPI);
    const imgData = canvas.toDataURL("image/png");

    const width = Math.max(1, Math.round(slide.width));
    const height = Math.max(1, Math.round(slide.height));
    const orientation = width >= height ? "landscape" : "portrait";

    if (i === 0) {
      doc = new jsPDF({
        orientation,
        unit: "px",
        format: [width, height],
        hotfixes: ["px_scaling"],
      });
      doc.addImage(imgData, "PNG", 0, 0, width, height, undefined, "FAST");
    } else if (doc) {
      doc.addPage([width, height], orientation);
      doc.addImage(imgData, "PNG", 0, 0, width, height, undefined, "FAST");
    }
  }

  if (doc) {
    doc.save(`${sceneName}.pdf`);
  }
}

/**
 * Lazy-loads PptxGenJS and exports all presentation slides as a Microsoft PowerPoint .pptx deck,
 * with each slide rendered at high fidelity with aspect-ratio preservation.
 */
export async function exportPresentationToPptx({
  excalidrawAPI,
  slides,
  onProgress,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  slides: readonly ExcalidrawFrameLikeElement[];
  onProgress?: (progress: ExportProgress) => void;
}): Promise<void> {
  if (!slides.length) {
    throw new Error("No presentation slides to export.");
  }

  // Lazy-load pptxgenjs so bundle remains lean
  const pptxgenModule = await import("pptxgenjs");
  const PptxGenJS = pptxgenModule.default;
  const pptx = new PptxGenJS();

  const appState = excalidrawAPI.getAppState();
  const sceneName = (appState.name?.trim() || "presentation").replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  const isDark = appState.theme === "dark";
  const bgColor = (
    appState.viewBackgroundColor || (isDark ? "#121212" : "#ffffff")
  ).replace("#", "");

  // Default 16:9 presentation dimensions (10 x 5.625 inches)
  const PPTX_WIDTH = 10;
  const PPTX_HEIGHT = 5.625;
  const pptxAspect = PPTX_WIDTH / PPTX_HEIGHT;

  pptx.layout = "LAYOUT_16x9";
  pptx.title = appState.name || "Presentation";

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    onProgress?.({ current: i + 1, total: slides.length, format: "pptx" });

    const canvas = await renderFrameToCanvas(slide, excalidrawAPI);
    const imgData = canvas.toDataURL("image/png");

    const pptxSlide = pptx.addSlide();
    pptxSlide.background = { color: bgColor };

    // Calculate fitted bounding box inside 16:9 maintaining aspect ratio
    const slideAspect = slide.width / Math.max(1, slide.height);
    let w = PPTX_WIDTH;
    let h = PPTX_HEIGHT;
    let x = 0;
    let y = 0;

    if (slideAspect > pptxAspect) {
      // Wider than 16:9
      w = PPTX_WIDTH;
      h = PPTX_WIDTH / slideAspect;
      y = (PPTX_HEIGHT - h) / 2;
    } else if (slideAspect < pptxAspect) {
      // Taller than 16:9
      h = PPTX_HEIGHT;
      w = PPTX_HEIGHT * slideAspect;
      x = (PPTX_WIDTH - w) / 2;
    }

    pptxSlide.addImage({
      data: imgData,
      x,
      y,
      w,
      h,
    });
  }

  await pptx.writeFile({ fileName: `${sceneName}.pptx` });
}
