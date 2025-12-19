/**
 * AI Status Panel Component
 * Shows real-time status messages near the AI button
 */

import { motion, AnimatePresence } from "framer-motion";

import "./AIStatusPanel.scss";

import type { AIStatus } from "../ai/types";

interface AIStatusPanelProps {
  status: AIStatus;
  isVisible: boolean;
}

const statusIcons: Record<string, React.ReactNode> = {
  idle: null,
  waiting: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" opacity="0.3" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  capturing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  processing: (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </motion.svg>
  ),
  complete: (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      initial={{ scale: 0.5 }}
      animate={{ scale: 1 }}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </motion.svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

export const AIStatusPanel = ({ status, isVisible }: AIStatusPanelProps) => {
  const shouldShow = isVisible && status.step !== "idle" && status.message;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className={`AIStatusPanel AIStatusPanel--${status.step}`}
          initial={{ opacity: 0, x: 20, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.9 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <span className="AIStatusPanel__icon">
            {statusIcons[status.step]}
          </span>
          <span className="AIStatusPanel__message">{status.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AIStatusPanel;
