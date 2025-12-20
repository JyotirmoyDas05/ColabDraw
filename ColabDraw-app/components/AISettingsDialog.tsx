/**
 * Smart Canvas AI - Settings Dialog Component
 *
 * Allows users to:
 * - Toggle AI on/off with visual indicator
 * - Switch between AI modes (API, Local, Auto)
 * - See their daily usage (X/15 requests)
 * - Add their own Gemini API key
 * - View local model download progress
 */

import { useState, useCallback, useEffect } from "react";

import {
  getUsage,
  getUserApiKey,
  setUserApiKey,
  hasUserProvidedKey,
  getActiveApiKey,
  hasApiKey,
  GOOGLE_AI_STUDIO_URL,
} from "../ai/geminiClient";
import { loadAISettings, saveAISettings } from "../ai/aiUtils";

import { StatefulButton } from "./StatefulButton";
import { SwitchWithLabel } from "./SwitchWithLabel";

import "./AISettingsDialog.scss";

import type { AIMode, DownloadState } from "../ai/types";

// SVG Icons (matching app style)
const CloseIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    role="img"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1.25rem", height: "1.25rem" }}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const BoltIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1.25rem", height: "1.25rem" }}
  >
    <path d="M13 3l-10 10h7l-1 8l10 -10h-7l1 -8" />
  </svg>
);

const CloudIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1.25rem", height: "1.25rem" }}
  >
    <path d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 .996c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878" />
  </svg>
);

const ComputerIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1.25rem", height: "1.25rem" }}
  >
    <path d="M3 4m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1z" />
    <path d="M7 20l10 0" />
    <path d="M9 16l0 4" />
    <path d="M15 16l0 4" />
  </svg>
);

const KeyIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1rem", height: "1rem" }}
  >
    <path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z" />
    <path d="M15 9h.01" />
  </svg>
);

const DownloadIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1rem", height: "1rem" }}
  >
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
    <path d="M7 11l5 5l5 -5" />
    <path d="M12 4l0 12" />
  </svg>
);

const CheckIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "1rem", height: "1rem" }}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: "0.875rem", height: "0.875rem" }}
  >
    <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
    <path d="M11 13l9 -9" />
    <path d="M15 4l5 0l0 5" />
  </svg>
);

interface AISettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApiKeyChange?: () => void;
  onModeChange?: (mode: AIMode) => void;
  onToggleAI?: (enabled: boolean) => void;
  isAIEnabled?: boolean;
  isRateLimited?: boolean;
  downloadState?: DownloadState;
  isQwenReady?: boolean;
  isJanusReady?: boolean;
  isModelLoading?: boolean;
  onInitializeModels?: () => void;
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Get mode display name
function getModeDisplayName(mode: AIMode): string {
  switch (mode) {
    case "auto":
      return "Auto Mode";
    case "api":
      return "API Mode";
    case "local":
      return "Local Mode";
    default:
      return "AI";
  }
}

export const AISettingsDialog = ({
  isOpen,
  onClose,
  onApiKeyChange,
  onModeChange,
  onToggleAI,
  isAIEnabled = true,
  isRateLimited = false,
  downloadState,
  isQwenReady = false,
  isJanusReady = false,
  isModelLoading = false,
  onInitializeModels,
}: AISettingsDialogProps) => {
  const [apiKey, setApiKeyState] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [usage, setUsage] = useState({ count: 0, limit: 15 });
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [aiMode, setAiModeState] = useState<AIMode>("auto");
  const [aiEnabled, setAiEnabled] = useState(isAIEnabled);
  const [isDownloading, setIsDownloading] = useState(false);

  // Load current state
  useEffect(() => {
    if (isOpen) {
      const currentKey = getUserApiKey();
      setApiKeyState(currentKey || "");
      setHasKey(hasUserProvidedKey());

      const apiKeyInfo = getActiveApiKey();
      if (apiKeyInfo) {
        const currentUsage = getUsage(apiKeyInfo.isUserKey);
        setUsage({ count: currentUsage.count, limit: currentUsage.limit });
      }

      // Load saved settings
      const settings = loadAISettings();
      setAiModeState(settings.aiMode || "auto");
      setAiEnabled(settings.aiEnabled ?? true);
    }
  }, [isOpen]);

  // Track downloading state
  useEffect(() => {
    setIsDownloading(isModelLoading);
  }, [isModelLoading]);

  const handleToggleAI = useCallback(() => {
    const newEnabled = !aiEnabled;
    setAiEnabled(newEnabled);
    const settings = loadAISettings();
    saveAISettings({ ...settings, aiEnabled: newEnabled });
    onToggleAI?.(newEnabled);
  }, [aiEnabled, onToggleAI]);

  const handleModeChange = useCallback(
    (mode: AIMode) => {
      setAiModeState(mode);
      const settings = loadAISettings();
      saveAISettings({ ...settings, aiMode: mode });
      onModeChange?.(mode);
    },
    [onModeChange],
  );

  const handleDownloadModels = useCallback(() => {
    if (onInitializeModels && !isDownloading && !isQwenReady) {
      setIsDownloading(true);
      onInitializeModels();
    }
  }, [onInitializeModels, isDownloading, isQwenReady]);

  const handleSaveKey = useCallback(() => {
    if (apiKey.trim()) {
      setUserApiKey(apiKey.trim());
      setHasKey(true);
      setSaveMessage("API key saved!");
      onApiKeyChange?.();

      // Update usage for new key
      const apiKeyInfo = getActiveApiKey();
      if (apiKeyInfo) {
        const currentUsage = getUsage(apiKeyInfo.isUserKey);
        setUsage({ count: currentUsage.count, limit: currentUsage.limit });
      }

      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [apiKey, onApiKeyChange]);

  const handleRemoveKey = useCallback(() => {
    setUserApiKey(null);
    setApiKeyState("");
    setHasKey(false);
    setSaveMessage("API key removed");
    onApiKeyChange?.();

    // Update usage for default key
    const apiKeyInfo = getActiveApiKey();
    if (apiKeyInfo) {
      const currentUsage = getUsage(apiKeyInfo.isUserKey);
      setUsage({ count: currentUsage.count, limit: currentUsage.limit });
    }

    setTimeout(() => setSaveMessage(null), 3000);
  }, [onApiKeyChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSaveKey();
      }
    },
    [handleSaveKey],
  );

  if (!isOpen) {
    return null;
  }

  const remainingCalls = Math.max(0, usage.limit - usage.count);
  const usagePercent = (usage.count / usage.limit) * 100;
  const showLocalModels =
    aiMode === "local" || (aiMode === "auto" && !isQwenReady);
  const showAPIUsage = aiMode === "api" || aiMode === "auto";

  return (
    <div className="AISettingsDialog__overlay" onClick={onClose}>
      <div
        className="AISettingsDialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
      >
        {/* Header with Toggle */}
        <div className="AISettingsDialog__header">
          <div className="AISettingsDialog__header-left">
            <h2 id="ai-settings-title" className="AISettingsDialog__title">
              Smart Canvas AI
            </h2>
          </div>
          <div className="AISettingsDialog__header-right">
            {/* AI Toggle Switch */}
            <SwitchWithLabel
              name="ai-enabled"
              isSelected={aiEnabled}
              onValueChange={handleToggleAI}
              onLabel={`${getModeDisplayName(aiMode)} ON`}
              offLabel="OFF"
              size="sm"
              color="primary"
            />
            <button
              className="AISettingsDialog__close"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="AISettingsDialog__content">
          {/* No API Key Warning */}
          {!hasApiKey() && (aiMode === "api" || aiMode === "auto") && (
            <div className="AISettingsDialog__warning AISettingsDialog__warning--info">
              <strong>API Key Required</strong>
              <p>
                No Gemini API key is configured. Add your own API key below to
                use API mode, or switch to Local mode.
              </p>
            </div>
          )}

          {/* Rate Limit Warning */}
          {isRateLimited && hasApiKey() && (
            <div className="AISettingsDialog__warning">
              <strong>Daily limit reached</strong>
              <p>
                You have used all {usage.limit} free requests for today. Add
                your own API key or switch to Local mode.
              </p>
            </div>
          )}

          {/* AI Mode Selector */}
          <div className="AISettingsDialog__section">
            <h3 className="AISettingsDialog__section-title">AI Mode</h3>
            <p className="AISettingsDialog__section-desc">
              Choose how Smart Canvas AI processes your drawings.
            </p>

            <div className="AISettingsDialog__modes">
              <button
                className={`AISettingsDialog__mode-option ${
                  aiMode === "auto" ? "is-active" : ""
                }`}
                onClick={() => handleModeChange("auto")}
              >
                <span className="AISettingsDialog__mode-icon">
                  <BoltIcon />
                </span>
                <div className="AISettingsDialog__mode-content">
                  <span className="AISettingsDialog__mode-label">Auto</span>
                  <span className="AISettingsDialog__mode-desc">
                    Uses API first, falls back to local
                  </span>
                </div>
              </button>

              <button
                className={`AISettingsDialog__mode-option ${
                  aiMode === "api" ? "is-active" : ""
                }`}
                onClick={() => handleModeChange("api")}
              >
                <span className="AISettingsDialog__mode-icon">
                  <CloudIcon />
                </span>
                <div className="AISettingsDialog__mode-content">
                  <span className="AISettingsDialog__mode-label">API Only</span>
                  <span className="AISettingsDialog__mode-desc">
                    Fast, accurate (Gemini 2.5 Flash)
                  </span>
                </div>
              </button>

              <button
                className={`AISettingsDialog__mode-option ${
                  aiMode === "local" ? "is-active" : ""
                }`}
                onClick={() => handleModeChange("local")}
              >
                <span className="AISettingsDialog__mode-icon">
                  <ComputerIcon />
                </span>
                <div className="AISettingsDialog__mode-content">
                  <span className="AISettingsDialog__mode-label">
                    Local Only
                  </span>
                  <span className="AISettingsDialog__mode-desc">
                    Private, offline (Qwen2-VL-2B)
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Local Model Status - Only show for Local mode or Auto when models needed */}
          {showLocalModels && (
            <div className="AISettingsDialog__section">
              <h3 className="AISettingsDialog__section-title">Local Models</h3>
              <div className="AISettingsDialog__models">
                {/* Qwen Model */}
                <div className="AISettingsDialog__model">
                  <div className="AISettingsDialog__model-header">
                    <span className="AISettingsDialog__model-name">
                      Qwen2-VL-2B
                    </span>
                    <span className="AISettingsDialog__model-purpose">
                      Understanding
                    </span>
                    {isQwenReady ? (
                      <span className="AISettingsDialog__model-status is-ready">
                        <CheckIcon /> Ready
                      </span>
                    ) : isModelLoading && downloadState?.qwen ? (
                      <span className="AISettingsDialog__model-status is-loading">
                        {Math.round(downloadState.qwen.progress)}%
                      </span>
                    ) : (
                      <span className="AISettingsDialog__model-status">
                        Not loaded
                      </span>
                    )}
                  </div>
                  {isModelLoading &&
                    downloadState?.qwen &&
                    downloadState.qwen.status === "downloading" && (
                      <div className="AISettingsDialog__model-progress">
                        <div className="AISettingsDialog__progress-bar">
                          <div
                            className="AISettingsDialog__progress-fill"
                            style={{ width: `${downloadState.qwen.progress}%` }}
                          />
                        </div>
                        {downloadState.qwen.total > 0 && (
                          <span className="AISettingsDialog__progress-text">
                            {formatBytes(downloadState.qwen.loaded)} /{" "}
                            {formatBytes(downloadState.qwen.total)}
                          </span>
                        )}
                      </div>
                    )}
                </div>

                {/* Janus Model */}
                <div className="AISettingsDialog__model">
                  <div className="AISettingsDialog__model-header">
                    <span className="AISettingsDialog__model-name">
                      Janus-Pro-1B
                    </span>
                    <span className="AISettingsDialog__model-purpose">
                      Image Gen (Optional)
                    </span>
                    {isJanusReady ? (
                      <span className="AISettingsDialog__model-status is-ready">
                        <CheckIcon /> Ready
                      </span>
                    ) : downloadState?.janus?.status === "error" ? (
                      <span className="AISettingsDialog__model-status is-optional">
                        Not available
                      </span>
                    ) : (
                      <span className="AISettingsDialog__model-status">
                        Not loaded
                      </span>
                    )}
                  </div>
                </div>

                {/* Download Button - Always show if not ready */}
                {!isQwenReady && (
                  <StatefulButton
                    onClick={handleDownloadModels}
                    isLoading={isDownloading}
                    disabled={isDownloading}
                  >
                    <DownloadIcon />
                    Download Local Models (~2GB)
                  </StatefulButton>
                )}
              </div>
            </div>
          )}

          {/* API Usage Section - Only for API and Auto modes */}
          {showAPIUsage && (
            <>
              <div className="AISettingsDialog__section">
                <h3 className="AISettingsDialog__section-title">
                  Free Daily Usage
                </h3>
                <p className="AISettingsDialog__section-desc">
                  You get {usage.limit} free AI requests per day using our API
                  key.
                </p>
                <div className="AISettingsDialog__usage">
                  <div className="AISettingsDialog__usage-bar">
                    <div
                      className="AISettingsDialog__usage-fill"
                      style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                  </div>
                  <div className="AISettingsDialog__usage-text">
                    <span>
                      {usage.count} / {usage.limit} requests used
                    </span>
                    {remainingCalls > 0 && (
                      <span className="AISettingsDialog__usage-remaining">
                        {remainingCalls} remaining today
                      </span>
                    )}
                  </div>
                </div>
                {hasKey && (
                  <p className="AISettingsDialog__usage-note">
                    <CheckIcon /> Using your own API key (higher limits)
                  </p>
                )}
              </div>

              {/* OR Separator */}
              <div className="AISettingsDialog__separator">
                <span>OR</span>
              </div>

              {/* API Key Section */}
              <div className="AISettingsDialog__section">
                <h3 className="AISettingsDialog__section-title">
                  Your Gemini API Key
                </h3>
                <p className="AISettingsDialog__section-desc">
                  Add your own API key for unlimited access beyond the free
                  daily limit.
                </p>

                <div className="AISettingsDialog__api-key">
                  <div className="AISettingsDialog__api-key-input-wrapper">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKeyState(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Enter your Gemini API key"
                      className="AISettingsDialog__api-key-input"
                    />
                    <button
                      className="AISettingsDialog__api-key-toggle"
                      onClick={() => setShowApiKey(!showApiKey)}
                      title={showApiKey ? "Hide" : "Show"}
                      type="button"
                    >
                      {showApiKey ? "Hide" : "Show"}
                    </button>
                  </div>

                  <div className="AISettingsDialog__api-key-actions">
                    <button
                      className="AISettingsDialog__save-btn"
                      onClick={handleSaveKey}
                      disabled={!apiKey.trim()}
                    >
                      Save Key
                    </button>
                    {hasKey && (
                      <button
                        className="AISettingsDialog__remove-btn"
                        onClick={handleRemoveKey}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {saveMessage && (
                  <p className="AISettingsDialog__save-message">
                    {saveMessage}
                  </p>
                )}

                {/* Get API Key Link */}
                <a
                  href={GOOGLE_AI_STUDIO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="AISettingsDialog__get-key-link"
                >
                  <KeyIcon />
                  Get a free API key from Google AI Studio
                  <ExternalLinkIcon />
                </a>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="AISettingsDialog__footer">
          <span>
            Powered by{" "}
            {aiMode === "local" ? "Qwen2-VL-2B (local)" : "Gemini 2.5 Flash"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AISettingsDialog;
