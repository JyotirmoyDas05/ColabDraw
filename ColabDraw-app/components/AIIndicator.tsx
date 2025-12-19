/*
 * Smart Canvas AI - UI Indicator Component
 *
 * Shows AI status (loading, analyzing) and browser compatibility warnings.
 * Supports hybrid AI system with per-model download progress.
 */

import { useState, useCallback } from "react";

import "./AIIndicator.scss";

import type { UseCanvasAIReturn } from "../ai/types";

interface AIIndicatorProps {
  aiState: UseCanvasAIReturn;
  onToggleAI?: (enabled: boolean) => void;
  isAIEnabled: boolean;
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const AIIndicator = ({
  aiState,
  onToggleAI,
  isAIEnabled,
}: AIIndicatorProps) => {
  const {
    isAnalyzing,
    isModelLoading,
    isQwenReady,
    downloadState,
    error,
    backend,
    showBrowserBanner,
    isUsingAPI,
    apiUsage,
    cancelOperation,
    dismissBrowserBanner,
    initializeModels,
  } = aiState;

  const [showTooltip, setShowTooltip] = useState(false);

  const isModelReady = isQwenReady; // Qwen is the main model

  const handleToggle = useCallback(() => {
    if (onToggleAI) {
      onToggleAI(!isAIEnabled);
    }
  }, [onToggleAI, isAIEnabled]);

  const handlePreload = useCallback(() => {
    initializeModels();
  }, [initializeModels]);

  return (
    <div className="ai-indicator-container">
      {/* Browser Compatibility Banner */}
      {showBrowserBanner && (
        <div className="ai-browser-banner">
          <div className="ai-browser-banner__content">
            <span className="ai-browser-banner__icon">⚠️</span>
            <span className="ai-browser-banner__text">
              Smart Canvas AI works best in Chrome or Edge. Your browser has
              limited WebGPU support which may affect performance.
            </span>
          </div>
          <button
            className="ai-browser-banner__dismiss"
            onClick={dismissBrowserBanner}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* AI Status Indicator */}
      <div
        className="ai-status-indicator"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* AI Toggle Button */}
        <button
          className={`ai-toggle-button ${isAIEnabled ? "enabled" : ""}`}
          onClick={handleToggle}
          title={
            isAIEnabled ? "Disable Smart Canvas AI" : "Enable Smart Canvas AI"
          }
        >
          <span className="ai-toggle-icon">🤖</span>
        </button>

        {/* Preload Button */}
        {isAIEnabled && !isModelReady && !isModelLoading && (
          <button
            className="ai-preload-button"
            onClick={handlePreload}
            title="Preload AI Model"
          >
            ⬇️
          </button>
        )}

        {/* Loading State with Per-Model Progress */}
        {isModelLoading && (
          <div className="ai-loading">
            <div className="ai-loading__title">Downloading AI Models...</div>

            {/* Overall Progress */}
            <div className="ai-loading__bar">
              <div
                className="ai-loading__progress"
                style={{ width: `${downloadState.overallProgress}%` }}
              />
            </div>
            <span className="ai-loading__text">
              {Math.round(downloadState.overallProgress)}%
            </span>

            {/* Per-Model Progress */}
            <div className="ai-loading__models">
              {/* Qwen Model */}
              <div className="ai-loading__model">
                <div className="ai-loading__model-info">
                  <span className="ai-loading__model-name">
                    {downloadState.qwen.modelName}
                  </span>
                  {downloadState.qwen.status === "ready" ? (
                    <span className="ai-loading__model-ready">✓</span>
                  ) : (
                    <span className="ai-loading__model-file">
                      {downloadState.qwen.fileName.split("/").pop() || "..."}
                    </span>
                  )}
                </div>
                <div className="ai-loading__model-bar">
                  <div
                    className="ai-loading__model-progress"
                    style={{ width: `${downloadState.qwen.progress}%` }}
                  />
                </div>
                {downloadState.qwen.total > 0 &&
                  downloadState.qwen.status === "downloading" && (
                    <span className="ai-loading__model-size">
                      {formatBytes(downloadState.qwen.loaded)} /{" "}
                      {formatBytes(downloadState.qwen.total)}
                    </span>
                  )}
              </div>

              {/* Janus Model */}
              <div className="ai-loading__model">
                <div className="ai-loading__model-info">
                  <span className="ai-loading__model-name">
                    {downloadState.janus.modelName}
                  </span>
                  {downloadState.janus.status === "ready" ? (
                    <span className="ai-loading__model-ready">✓</span>
                  ) : downloadState.janus.status === "error" ? (
                    <span className="ai-loading__model-error">⚠️ Optional</span>
                  ) : (
                    <span className="ai-loading__model-file">
                      {downloadState.janus.fileName.split("/").pop() || "..."}
                    </span>
                  )}
                </div>
                <div className="ai-loading__model-bar">
                  <div
                    className="ai-loading__model-progress"
                    style={{ width: `${downloadState.janus.progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Analyzing State */}
        {isAnalyzing && (
          <div className="ai-analyzing">
            <div className="ai-analyzing__pulse" />
            <span className="ai-analyzing__text">
              {isUsingAPI ? "🌐 API analyzing..." : "🖥️ Local AI analyzing..."}
            </span>
            <button
              className="ai-analyzing__cancel"
              onClick={cancelOperation}
              title="Cancel"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="ai-error">
            <span className="ai-error__icon">⚠️</span>
            <span className="ai-error__text">{error}</span>
          </div>
        )}

        {/* Tooltip */}
        {showTooltip && !isModelLoading && !isAnalyzing && (
          <div className="ai-tooltip">
            <div className="ai-tooltip__title">Smart Canvas AI</div>
            <div className="ai-tooltip__status">
              {isAIEnabled ? (
                isModelReady ? (
                  <>
                    <span className="ai-tooltip__ready">✓ Ready</span>
                    <span className="ai-tooltip__backend">
                      ({backend === "webgpu" ? "WebGPU" : "WASM"})
                    </span>
                  </>
                ) : (
                  <span className="ai-tooltip__notready">Not loaded</span>
                )
              ) : (
                <span className="ai-tooltip__notready">Disabled</span>
              )}
            </div>
            {apiUsage && (
              <div className="ai-tooltip__usage">
                API: {apiUsage.count}/{apiUsage.limit} today
              </div>
            )}
            <div className="ai-tooltip__hint">
              {isAIEnabled
                ? "Stop drawing for 3 seconds to trigger AI analysis"
                : "Click to enable Smart Canvas AI"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIIndicator;
