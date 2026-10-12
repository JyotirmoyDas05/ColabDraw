/**
 * AI Suggestion Panel
 *
 * Floating preview panel that appears when AI generates an image.
 * Shows preview with Accept (Tab) / Reject (Esc) options.
 */

import React, { useEffect } from "react";

import "./AISuggestionPanel.scss";

interface AISuggestionPanelProps {
  imageData: string | null;
  onAccept: () => void;
  onReject: () => void;
  isVisible: boolean;
}

export const AISuggestionPanel: React.FC<AISuggestionPanelProps> = ({
  imageData,
  onAccept,
  onReject,
  isVisible,
}) => {
  useEffect(() => {
    if (!isVisible || !imageData) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        onAccept();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, imageData, onAccept, onReject]);

  if (!isVisible || !imageData) {
    return null;
  }

  const imageSrc = imageData.startsWith("data:")
    ? imageData
    : `data:image/png;base64,${imageData}`;

  return (
    <div className="ai-suggestion-panel">
      <div className="ai-suggestion-panel__container">
        <div className="ai-suggestion-panel__header">
          <div className="ai-suggestion-panel__title">
            <span className="ai-suggestion-panel__badge">AI</span>
            <span className="ai-suggestion-panel__label">Suggestion</span>
          </div>
          <button
            className="ai-suggestion-panel__close"
            onClick={onReject}
            title="Close (Esc)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ai-suggestion-panel__preview">
          <img
            src={imageSrc}
            alt="AI generated diagram"
            className="ai-suggestion-panel__image"
          />
        </div>

        <div className="ai-suggestion-panel__actions">
          <button
            className="ai-suggestion-panel__btn ai-suggestion-panel__btn--reject"
            onClick={onReject}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Reject (Esc)
          </button>
          <button
            className="ai-suggestion-panel__btn ai-suggestion-panel__btn--accept"
            onClick={onAccept}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Accept (Tab)
          </button>
        </div>
      </div>
    </div>
  );
};
