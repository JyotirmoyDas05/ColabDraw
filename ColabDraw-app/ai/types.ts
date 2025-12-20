/**
 * Smart Canvas AI - TypeScript Type Definitions
 *
 * Types for hybrid AI system: Gemini API + Qwen2-VL-2B + Janus-Pro-1B
 */

// ============================================================================
// AI Mode Types
// ============================================================================

/** AI processing mode */
export type AIMode = "api" | "local" | "auto";

/** Which local model to use */
export type LocalModel = "qwen" | "janus";

// ============================================================================
// Download Progress Types
// ============================================================================

/** Progress for a single model download */
export interface ModelDownloadProgress {
  modelName: string;
  fileName: string;
  progress: number; // 0-100
  loaded: number; // bytes
  total: number; // bytes
  status: "pending" | "downloading" | "ready" | "error";
}

/** Combined download state for all local models */
export interface DownloadState {
  qwen: ModelDownloadProgress;
  janus: ModelDownloadProgress;
  overallProgress: number; // 0-100
}

/** Initial download state */
export const INITIAL_DOWNLOAD_STATE: DownloadState = {
  qwen: {
    modelName: "Qwen2-VL-2B",
    fileName: "",
    progress: 0,
    loaded: 0,
    total: 0,
    status: "pending",
  },
  janus: {
    modelName: "Janus-Pro-1B",
    fileName: "",
    progress: 0,
    loaded: 0,
    total: 0,
    status: "pending",
  },
  overallProgress: 0,
};

// ============================================================================
// Worker Message Types
// ============================================================================

/** Messages sent from main thread to AI worker */
export interface AIWorkerMessage {
  type: "init" | "analyze" | "generate_image" | "cancel";
  /** Base64 data URL of the canvas image */
  image?: string;
  /** Custom prompt */
  prompt?: string;
  /** Request ID for tracking */
  requestId?: string;
}

/** Responses sent from AI worker to main thread */
export interface AIWorkerResponse {
  type:
    | "download_progress"
    | "model_ready"
    | "analyzing"
    | "token"
    | "complete"
    | "image_generated"
    | "error"
    | "cancelled";
  /** Which model this update is for */
  model?: LocalModel;
  /** Download progress data */
  progress?: ModelDownloadProgress;
  /** Streaming token during generation */
  token?: string;
  /** Full response text when complete */
  response?: string;
  /** Generated image data URL */
  imageDataUrl?: string;
  /** Error message */
  error?: string;
  /** Request ID for tracking */
  requestId?: string;
  /** Backend being used */
  backend?: "webgpu" | "wasm";
}

// ============================================================================
// Gemini API Types
// ============================================================================

/** Gemini API configuration */
export interface GeminiConfig {
  apiKey: string;
  isUserKey: boolean; // true if user provided their own key
}

/** Gemini API usage tracking */
export interface GeminiUsage {
  date: string; // YYYY-MM-DD
  count: number;
  limit: number; // 15 for default key
}

// ============================================================================
// Settings Types
// ============================================================================

/** AI feature settings stored in localStorage */
export interface AISettings {
  /** Master toggle for the AI feature */
  aiEnabled: boolean;
  /** Seconds of inactivity before triggering AI analysis */
  aiInactivityDelay: number;
  /** Whether to auto-trigger on inactivity */
  aiAutoTrigger: boolean;
  /** Whether the user has dismissed the browser compatibility banner */
  browserBannerDismissed: boolean;
  /** AI processing mode: api, local, or auto */
  aiMode: AIMode;
  /** User's own Gemini API key (optional) */
  userGeminiKey: string | null;
  /** Enable image generation with Janus */
  enableImageGeneration: boolean;
}

/** Default AI settings */
export const DEFAULT_AI_SETTINGS: AISettings = {
  aiEnabled: false, // OFF by default - user must explicitly enable
  aiInactivityDelay: 3,
  aiAutoTrigger: true,
  browserBannerDismissed: false,
  aiMode: "auto",
  userGeminiKey: null,
  enableImageGeneration: true,
};

// ============================================================================
// Hook Return Types
// ============================================================================

/** Return type for useCanvasAI hook */
export interface UseCanvasAIReturn {
  // Mode & Settings
  /** Current AI mode */
  aiMode: AIMode;
  /** Whether using API or local */
  isUsingAPI: boolean;

  // Model States
  /** Whether Qwen model is ready */
  isQwenReady: boolean;
  /** Whether Janus model is ready */
  isJanusReady: boolean;
  /** Download state for local models */
  downloadState: DownloadState;
  /** Backend being used (webgpu/wasm) */
  backend: "webgpu" | "wasm" | null;

  // Operation States
  /** Whether currently analyzing */
  isAnalyzing: boolean;
  /** Whether generating an image */
  isGeneratingImage: boolean;
  /** Whether models are loading */
  isModelLoading: boolean;

  // Results
  /** AI response text */
  aiResponse: string | null;
  /** Generated image data URL */
  generatedImage: string | null;
  /** Error message */
  error: string | null;

  // API Usage
  /** Today's Gemini API usage */
  apiUsage: GeminiUsage | null;

  // UI State
  /** Whether to show browser compatibility banner */
  showBrowserBanner: boolean;
  /** Current AI status for display */
  status: AIStatus;

  // Actions
  /** Initialize/preload models */
  initializeModels: () => void;
  /** Analyze canvas content */
  analyzeCanvas: () => void;
  /** Generate diagram from prompt */
  generateDiagram: (prompt: string) => void;
  /** Cancel current operation */
  cancelOperation: () => void;
  /** Clear response */
  clearResponse: () => void;
  /** Track user activity */
  trackActivity: () => void;
  /** Dismiss browser banner */
  dismissBrowserBanner: () => void;
  /** Set AI mode */
  setAIMode: (mode: AIMode) => void;
  /** Set user's Gemini API key */
  setUserGeminiKey: (key: string | null) => void;
  /** Refresh API usage state */
  refreshApiUsage: () => void;
}

// ============================================================================
// AI Status Types
// ============================================================================

/** AI processing status for real-time display */
export type AIStatusStep =
  | "idle"
  | "waiting"
  | "capturing"
  | "processing"
  | "complete"
  | "error";

export interface AIStatus {
  step: AIStatusStep;
  message: string;
  timestamp: number;
}

// ============================================================================
// Browser Detection Types
// ============================================================================

export type BrowserType = "chrome" | "firefox" | "safari" | "edge" | "other";

export interface BrowserInfo {
  type: BrowserType;
  isChromiumBased: boolean;
  hasFullWebGPU: boolean;
}

// ============================================================================
// AI Response Types
// ============================================================================

/** Position for placing AI response on canvas */
export interface AIResponsePosition {
  x: number;
  y: number;
}

/** Types of AI-generated content */
export type AIOutputType = "text" | "diagram" | "mermaid" | "elements";

/** Parsed AI response with metadata */
export interface ParsedAIResponse {
  text: string;
  outputType: AIOutputType;
  /** Mermaid code if outputType is 'mermaid' */
  mermaidCode?: string;
  /** Excalidraw elements if outputType is 'elements' */
  elements?: unknown[];
}
