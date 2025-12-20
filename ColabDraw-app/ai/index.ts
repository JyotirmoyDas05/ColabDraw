/**
 * Smart Canvas AI Module
 *
 * Barrel export for AI-related functionality.
 */

export * from "./types";
export { useCanvasAI } from "./useCanvasAI";
export {
  captureCanvas,
  buildAIPrompt,
  detectBrowser,
  createAIResponseElement,
  findPlaceholderElements,
  updatePlaceholderWithResponse,
  loadAISettings,
  saveAISettings,
  calculateResponsePosition,
} from "./aiUtils";
export {
  analyzeWithGemini,
  isGeminiAvailable,
  isRateLimited,
  hasApiKey,
  getUsage,
  getUserApiKey,
  setUserApiKey,
  getActiveApiKey,
  getDefaultApiKey,
  getRemainingCalls,
  GOOGLE_AI_STUDIO_URL,
} from "./geminiClient";
