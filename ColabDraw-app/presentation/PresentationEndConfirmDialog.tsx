import React, { useEffect } from "react";
import "./PresentationEndConfirmDialog.scss";

interface PresentationEndConfirmDialogProps {
  isOpen: boolean;
  isPublic: boolean;
  onTogglePublic: (isPublic: boolean) => void;
  onConfirmEnd: () => void;
  onCancel: () => void;
}

export const PresentationEndConfirmDialog: React.FC<
  PresentationEndConfirmDialogProps
> = ({ isOpen, isPublic, onTogglePublic, onConfirmEnd, onCancel }) => {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="presentation-confirm-dialog-overlay"
      onClick={onCancel}
      aria-hidden="false"
    >
      <div
        className="presentation-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="presentation-confirm-dialog-title"
      >
        <div className="presentation-confirm-dialog__header">
          <div className="presentation-confirm-dialog__icon-wrap">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </div>
          <div className="presentation-confirm-dialog__titles">
            <h2
              id="presentation-confirm-dialog-title"
              className="presentation-confirm-dialog__title"
            >
              End presentation
            </h2>
            <p className="presentation-confirm-dialog__desc">
              Are you sure you want to end this presentation? Viewers won't be
              able to follow along anymore.
            </p>
          </div>
        </div>

        <div className="presentation-confirm-dialog__card">
          <div className="presentation-confirm-dialog__card-heading">
            Before you go...
          </div>
          <div className="presentation-confirm-dialog__row">
            <div className="presentation-confirm-dialog__row-info">
              <span className="presentation-confirm-dialog__row-title">
                Public access
              </span>
              <span className="presentation-confirm-dialog__row-sub">
                Make this presentation public so anyone with the link can view
                it
              </span>
            </div>
            <label className="presentation-toggle-switch">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => onTogglePublic(e.target.checked)}
              />
              <span className="presentation-toggle-switch__slider" />
            </label>
          </div>
        </div>

        <div className="presentation-confirm-dialog__actions">
          <button
            type="button"
            className="presentation-confirm-dialog__btn presentation-confirm-dialog__btn--danger"
            onClick={onConfirmEnd}
          >
            End presentation
          </button>
          <button
            type="button"
            className="presentation-confirm-dialog__btn presentation-confirm-dialog__btn--cancel"
            onClick={onCancel}
          >
            Keep presenting
          </button>
        </div>
      </div>
    </div>
  );
};
