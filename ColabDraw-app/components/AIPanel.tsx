/**
 * AI Panel Component - Floating AI Control Panel
 *
 * Design inspired by FloatingAIPanel with:
 * - Upper section: AI icon + textarea + action buttons
 * - Active underline effect on input
 * - Bottom settings bar with checkboxes and Return hint
 */

import React, { useState, useCallback, useRef, useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./AIPanel.scss";

import type { UseCanvasAIReturn } from "../ai/types";

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface AIPanelProps {
  canvasAI: UseCanvasAIReturn;
  excalidrawAPI: ExcalidrawImperativeAPI;
}

// Check if speech recognition is available
const hasSpeechRecognition =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const AIPanel: React.FC<AIPanelProps> = ({ canvasAI }) => {
  const [prompt, setPrompt] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    runWithPrompt,
    cancelOperation,
    autoRunEnabled,
    setAutoRun,
    selectionOnly,
    setSelectionOnly,
    isAnalyzing,
    outputMode,
    setOutputMode,
  } = canvasAI;

  // Auto-resize textarea - starts at single line, expands as needed
  useEffect(() => {
    if (textareaRef.current) {
      // Reset to minimum height first
      textareaRef.current.style.height = "24px";
      // Only expand if scroll height exceeds the single line
      const scrollHeight = textareaRef.current.scrollHeight;
      if (scrollHeight > 24) {
        textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
        textareaRef.current.style.overflowY =
          scrollHeight > 120 ? "auto" : "hidden";
      }
    }
  }, [prompt]);

  // Initialize speech recognition
  useEffect(() => {
    if (!hasSpeechRecognition) {
      return;
    }

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      return;
    }
    const recognition = new SpeechRecognitionAPI();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += `${result[0].transcript} `;
        }
      }
      if (finalTranscript) {
        setTranscript((prev) => prev + finalTranscript);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  // Handle run
  const handleRun = useCallback(() => {
    const textToRun = transcript.trim() || prompt.trim();
    if (!textToRun) {
      return;
    }

    runWithPrompt(textToRun);
    setPrompt("");
    setTranscript("");
  }, [prompt, transcript, runWithPrompt]);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleRun();
      }
    },
    [handleRun],
  );

  // Handle voice toggle
  const toggleVoice = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (transcript.trim()) {
        runWithPrompt(transcript.trim());
        setTranscript("");
      }
    } else {
      setTranscript("");
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error("Failed to start recognition:", err);
      }
    }
  }, [isListening, transcript, runWithPrompt]);

  const hasInput = prompt.length > 0 || transcript.length > 0;

  return (
    <div className="ai-panel-v2">
      <div className="ai-panel-v2__container">
        {/* Upper Input Section */}
        <div className="ai-panel-v2__input-section">
          {/* AI Icon */}
          <div className="ai-panel-v2__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
              <path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z" opacity="0.7" />
            </svg>
          </div>

          {/* Input Field Area */}
          <div className="ai-panel-v2__input-wrapper">
            <textarea
              ref={textareaRef}
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              className="ai-panel-v2__textarea"
              placeholder={
                isListening ? "Listening..." : "Describe or ask about canvas..."
              }
              disabled={isAnalyzing}
            />
            {/* Active Underline Effect */}
            <div className="ai-panel-v2__underline">
              <div
                className="ai-panel-v2__underline-fill"
                style={{ width: hasInput ? "100%" : "0%" }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="ai-panel-v2__actions">
            <button
              className="ai-panel-v2__btn ai-panel-v2__btn--primary"
              onClick={handleRun}
              disabled={isAnalyzing || !hasInput}
              title="Add to canvas"
            >
              {isAnalyzing ? (
                <svg
                  className="ai-panel-v2__spinner"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeDasharray="31.4 31.4"
                  />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>

            {hasSpeechRecognition && (
              <button
                className={`ai-panel-v2__btn ai-panel-v2__btn--secondary ${
                  isListening ? "listening" : ""
                }`}
                onClick={toggleVoice}
                disabled={isAnalyzing}
                title={isListening ? "Stop listening" : "Voice input"}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="ai-panel-v2__divider" />

        {/* Bottom Settings Bar */}
        <div className="ai-panel-v2__settings">
          {/* Left: Checkboxes */}
          <div className="ai-panel-v2__settings-left">
            <label className="ai-panel-v2__checkbox-label">
              <input
                type="checkbox"
                checked={autoRunEnabled}
                onChange={(e) => setAutoRun(e.target.checked)}
                className="ai-panel-v2__checkbox"
              />
              <span className="ai-panel-v2__checkbox-custom">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="ai-panel-v2__checkbox-text">
                Auto-run after inactivity
              </span>
            </label>

            <label className="ai-panel-v2__checkbox-label">
              <input
                type="checkbox"
                checked={selectionOnly}
                onChange={(e) => setSelectionOnly(e.target.checked)}
                className="ai-panel-v2__checkbox"
              />
              <span className="ai-panel-v2__checkbox-custom">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="ai-panel-v2__checkbox-text">Selection only</span>
            </label>
          </div>

          {/* Right: Mode Toggle + Hint */}
          <div className="ai-panel-v2__settings-right">
            {/* Mode Toggle */}
            <div className="ai-panel-v2__mode-toggle">
              <button
                className={`ai-panel-v2__mode-btn ${
                  outputMode === "text" ? "active" : ""
                }`}
                onClick={() => setOutputMode("text")}
                title="Text analysis mode"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Text
              </button>
              <button
                className={`ai-panel-v2__mode-btn ${
                  outputMode === "image" ? "active" : ""
                }`}
                onClick={() => setOutputMode("image")}
                title="Image generation mode"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Image
              </button>
            </div>

            {isAnalyzing && (
              <button
                className="ai-panel-v2__cancel"
                onClick={cancelOperation}
                title="Cancel"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
