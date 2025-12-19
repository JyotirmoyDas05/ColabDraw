/**
 * Stateful Button Component
 * Animated download button with loading and success states
 * Inspired by Aceternity UI
 */

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

import "./StatefulButton.scss";

interface StatefulButtonProps {
  children: React.ReactNode;
  onClick?: () => Promise<void> | void;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}

type ButtonState = "idle" | "loading" | "success";

export const StatefulButton = ({
  children,
  onClick,
  disabled = false,
  isLoading = false,
  className = "",
}: StatefulButtonProps) => {
  const [state, setState] = useState<ButtonState>("idle");

  // Sync external loading state
  React.useEffect(() => {
    if (isLoading && state === "idle") {
      setState("loading");
    } else if (!isLoading && state === "loading") {
      setState("success");
      const timer = setTimeout(() => setState("idle"), 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, state]);

  const handleClick = useCallback(async () => {
    if (state !== "idle" || disabled) {
      return;
    }

    setState("loading");

    try {
      await onClick?.();
      // Note: Success state is handled by isLoading prop change
    } catch {
      setState("idle");
    }
  }, [onClick, state, disabled]);

  return (
    <motion.button
      layout
      className={`StatefulButton ${
        state !== "idle" ? "is-active" : ""
      } ${className}`}
      onClick={handleClick}
      disabled={disabled || state !== "idle"}
      whileHover={state === "idle" ? { scale: 1.02 } : {}}
      whileTap={state === "idle" ? { scale: 0.98 } : {}}
    >
      <motion.div layout className="StatefulButton__content">
        <AnimatePresence mode="wait">
          {state === "loading" && (
            <motion.div
              key="loader"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 20 }}
              exit={{ opacity: 0, width: 0 }}
              className="StatefulButton__icon"
            >
              <LoaderIcon />
            </motion.div>
          )}
          {state === "success" && (
            <motion.div
              key="check"
              initial={{ opacity: 0, scale: 0.5, width: 0 }}
              animate={{ opacity: 1, scale: 1, width: 20 }}
              exit={{ opacity: 0, scale: 0.5, width: 0 }}
              className="StatefulButton__icon"
            >
              <CheckCircleIcon />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.span layout className="StatefulButton__label">
          {state === "loading"
            ? "Downloading..."
            : state === "success"
            ? "Downloaded!"
            : children}
        </motion.span>
      </motion.div>
    </motion.button>
  );
};

// Loader Icon (spinning)
const LoaderIcon = () => (
  <motion.svg
    animate={{ rotate: 360 }}
    transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="StatefulButton__svg"
  >
    <path d="M12 3a9 9 0 1 0 9 9" />
  </motion.svg>
);

// Check Circle Icon
const CheckCircleIcon = () => (
  <motion.svg
    initial={{ pathLength: 0 }}
    animate={{ pathLength: 1 }}
    transition={{ duration: 0.3 }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="StatefulButton__svg"
  >
    <circle cx="12" cy="12" r="9" />
    <motion.path
      d="M9 12l2 2l4 -4"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    />
  </motion.svg>
);

export default StatefulButton;
