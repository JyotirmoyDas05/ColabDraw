/**
 * Smart Canvas AI - Utility Functions
 *
 * Helper functions for canvas capture, prompt building, browser detection,
 * and AI response element creation.
 */

import { exportToBlob, getDataURL, MIME_TYPES } from "@excalidraw/excalidraw";
import { randomId } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEFAULT_AI_SETTINGS } from "./types";

import type {
  BrowserInfo,
  BrowserType,
  AIResponsePosition,
  AISettings,
} from "./types";

// ============================================================================
// Canvas Capture
// ============================================================================

/**
 * Captures the current canvas as a base64 data URL.
 * Uses existing exportToBlob utility for consistent rendering.
 *
 * @param excalidrawAPI - The Excalidraw imperative API
 * @param selectedOnly - If true, only capture selected elements
 * @returns Base64 data URL of the canvas, or null if canvas is empty
 */
export async function captureCanvas(
  excalidrawAPI: ExcalidrawImperativeAPI,
  selectedOnly: boolean = false,
): Promise<string | null> {
  const appState = excalidrawAPI.getAppState();
  const allElements = excalidrawAPI.getSceneElements();

  // Filter to non-deleted elements
  const elements = allElements.filter((el) => !el.isDeleted);

  if (elements.length === 0) {
    return null;
  }

  // If selectedOnly, filter to selected elements
  const targetElements = selectedOnly
    ? elements.filter((el) => appState.selectedElementIds[el.id])
    : elements;

  if (targetElements.length === 0) {
    return null;
  }

  try {
    const blob = await exportToBlob({
      elements: targetElements,
      appState: {
        ...appState,
        exportBackground: true,
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files: excalidrawAPI.getFiles(),
      mimeType: MIME_TYPES.png,
      // Keep reasonable size for model input
      maxWidthOrHeight: 1024,
    });

    const dataURL = await getDataURL(blob);
    return dataURL;
  } catch {
    // Silently fail if canvas capture fails
    return null;
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the AI prompt for canvas analysis.
 * Creates a context-aware system prompt for the vision model.
 *
 * @param context - Optional additional context
 * @returns The formatted prompt
 */
export function buildAIPrompt(context?: string): string {
  const systemPrompt = `You are an intelligent assistant analyzing a whiteboard/canvas. Based on what you see:
- If it's a math equation or expression, solve it and show the result.
- If it's a flowchart or diagram, explain what it represents or suggest completions.
- If it's a question written on the canvas, answer it concisely.
- If it's code or pseudocode, explain it or suggest improvements.
- If it's a sketch or wireframe, describe it or suggest UI improvements.
- If unclear, describe what you see and ask for clarification.

Be concise. Respond in 1-3 sentences unless more detail is needed.
Do not repeat the question. Just provide the answer or insight.`;

  const userMessage = context
    ? `Analyze this whiteboard: ${context}`
    : "Analyze this whiteboard and provide an appropriate response.";

  return `${systemPrompt}\n\nUser: ${userMessage}`;
}

// ============================================================================
// Browser Detection
// ============================================================================

/**
 * Detects the current browser type and WebGPU capabilities.
 * Used to show compatibility warnings for Firefox/Safari users.
 *
 * @returns Browser information including WebGPU support status
 */
export function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent.toLowerCase();

  let type: BrowserType = "other";
  let isChromiumBased = false;

  if (ua.includes("firefox")) {
    type = "firefox";
  } else if (ua.includes("safari") && !ua.includes("chrome")) {
    type = "safari";
  } else if (ua.includes("edg/")) {
    type = "edge";
    isChromiumBased = true;
  } else if (ua.includes("chrome")) {
    type = "chrome";
    isChromiumBased = true;
  }

  // Chrome and Edge have full WebGPU support
  // Firefox and Safari have limited API availability as of Dec 2025
  const hasFullWebGPU = isChromiumBased;

  return {
    type,
    isChromiumBased,
    hasFullWebGPU,
  };
}

/**
 * Returns a message suggesting Chromium-based browsers for optimal performance.
 */
export function getBrowserWarningMessage(browserInfo: BrowserInfo): string {
  if (browserInfo.hasFullWebGPU) {
    return "";
  }

  const browserName =
    browserInfo.type === "firefox"
      ? "Firefox"
      : browserInfo.type === "safari"
      ? "Safari"
      : "your browser";

  return `Smart Canvas AI works best in Chrome or Edge. ${browserName} has limited WebGPU support which may affect performance. Consider switching to a Chromium-based browser for the best experience.`;
}

// ============================================================================
// AI Response Element Creation
// ============================================================================

/**
 * Calculates the position for the AI response element.
 * Places it near selected elements or in the bottom-right of the viewport.
 *
 * @param excalidrawAPI - The Excalidraw imperative API
 * @returns The calculated position
 */
export function calculateResponsePosition(
  excalidrawAPI: ExcalidrawImperativeAPI,
): AIResponsePosition {
  const appState = excalidrawAPI.getAppState();
  const elements = excalidrawAPI.getSceneElements();

  // Check if there are selected elements
  const selectedIds = Object.keys(appState.selectedElementIds);
  const selectedElements = elements.filter(
    (el) => selectedIds.includes(el.id) && !el.isDeleted,
  );

  if (selectedElements.length > 0) {
    // Place near the selected elements (bottom-right of selection bounding box)
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of selectedElements) {
      const right = el.x + el.width;
      const bottom = el.y + el.height;
      if (right > maxX) {
        maxX = right;
      }
      if (bottom > maxY) {
        maxY = bottom;
      }
    }

    return {
      x: maxX + 20,
      y: maxY + 20,
    };
  }

  // Otherwise, place in bottom-right area of viewport
  const { scrollX, scrollY, width, height, zoom } = appState;

  // Convert viewport coordinates to scene coordinates
  const viewportRight = -scrollX + width / zoom.value;
  const viewportBottom = -scrollY + height / zoom.value;

  return {
    x: viewportRight - 300, // Leave some margin
    y: viewportBottom - 100,
  };
}

/**
 * Creates a text element for displaying the AI response on the canvas.
 * The element is styled distinctly to differentiate from user content.
 *
 * @param text - The AI response text
 * @param position - Where to place the element
 * @returns The new text element (partial, needs to be completed by Excalidraw)
 */
export function createAIResponseElement(
  text: string,
  position: AIResponsePosition,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const id = randomId();
  const now = Date.now();

  // Create a partial text element with AI-specific styling
  // Using 'any' return type to work around Excalidraw's branded types (Radians, lineHeight)
  return {
    id,
    type: "text",
    x: position.x,
    y: position.y,
    width: 200,
    height: 50,
    angle: 0,
    strokeColor: "#7c3aed", // Purple to distinguish AI content
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${now.toString(36)}` as any, // Fractional index required by Excalidraw
    roundness: null,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    // Text-specific properties
    text: `🤖 ${text}`,
    fontSize: 16,
    fontFamily: 1, // Virgil (hand-drawn style)
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: `🤖 ${text}`,
    autoResize: true,
    lineHeight: 1.25,
  };
}

// ============================================================================
// Local Storage Helpers
// ============================================================================

const AI_SETTINGS_KEY = "colabdraw-ai-settings";

/**
 * Loads AI settings from localStorage.
 */
export function loadAISettings(): AISettings {
  try {
    const stored = localStorage.getItem(AI_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Silently fail if settings can't be loaded
  }
  return DEFAULT_AI_SETTINGS;
}

/**
 * Saves AI settings to localStorage.
 */
export function saveAISettings(settings: AISettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Silently fail if settings can't be saved
  }
}
