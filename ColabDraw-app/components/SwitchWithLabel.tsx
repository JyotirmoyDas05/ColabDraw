/**
 * HeroUI-Style Switch with Label Component
 * A toggle switch with dynamic label that shows ON/OFF state
 *
 * Features:
 * - Data attributes for styling (data-selected, data-disabled, data-focus-visible)
 * - Smooth thumb slide animation with transform
 * - Press interaction effect
 * - Size variants (sm, md, lg)
 * - Color variants (primary, success, warning, danger)
 * - disableAnimation prop
 */

import { useState, useCallback, useRef, useEffect } from "react";

import "./SwitchWithLabel.scss";

// Module-level flag for keyboard focus detection
let hadKeyboardEvent = false;

if (typeof window !== "undefined") {
  // Set flag when Tab or Space is pressed
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Tab" || e.key === " " || e.key === "Enter") {
        hadKeyboardEvent = true;
      }
    },
    true,
  );

  // Clear flag on mouse/pointer interaction
  document.addEventListener(
    "mousedown",
    () => {
      hadKeyboardEvent = false;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      hadKeyboardEvent = false;
    },
    true,
  );
}

export interface SwitchWithLabelProps {
  /** Input name for form compatibility */
  name?: string;
  /** Input value */
  value?: string;
  /** Controlled selected state */
  isSelected?: boolean;
  /** Default selected state for uncontrolled usage */
  defaultSelected?: boolean;
  /** Callback when value changes (controlled) */
  onValueChange?: (isSelected: boolean) => void;
  /** Native change handler */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Label shown when switch is ON */
  onLabel?: string;
  /** Label shown when switch is OFF */
  offLabel?: string;
  /** Children as label (alternative to onLabel/offLabel) */
  children?: React.ReactNode;
  /** Whether the switch is disabled */
  isDisabled?: boolean;
  /** Whether to disable animations */
  disableAnimation?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Color variant */
  color?: "primary" | "success" | "warning" | "danger";
  /** Optional icon in thumb */
  thumbIcon?: React.ReactNode;
  /** Content at start of track */
  startContent?: React.ReactNode;
  /** Content at end of track */
  endContent?: React.ReactNode;
  /** Additional class name */
  className?: string;
}

export const SwitchWithLabel = ({
  name,
  value,
  isSelected: controlledSelected,
  defaultSelected = false,
  onValueChange,
  onChange,
  onLabel,
  offLabel = "OFF",
  children,
  isDisabled = false,
  disableAnimation = false,
  size = "md",
  color = "primary",
  thumbIcon,
  startContent,
  endContent,
  className = "",
}: SwitchWithLabelProps) => {
  // Determine if controlled or uncontrolled
  const isControlled = controlledSelected !== undefined;
  const [internalSelected, setInternalSelected] = useState(defaultSelected);
  const selected = isControlled ? controlledSelected : internalSelected;

  // Focus state
  const [isFocused, setIsFocused] = useState(false);
  const [isFocusVisible, setIsFocusVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.checked;

      if (!isControlled) {
        setInternalSelected(newValue);
      }

      onValueChange?.(newValue);
      onChange?.(e);
    },
    [isControlled, onValueChange, onChange],
  );

  // Focus handlers with focus-visible detection
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setIsFocusVisible(hadKeyboardEvent);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setIsFocusVisible(false);
  }, []);

  // Update focus-visible on key events while focused
  useEffect(() => {
    const handleKeyDown = () => {
      if (isFocused) {
        setIsFocusVisible(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFocused]);

  // Determine label text
  const labelText = children ?? (selected ? onLabel : offLabel);

  // Build class names
  const baseClass = [
    "switch",
    `switch--${size}`,
    `switch--${color}`,
    disableAnimation ? "switch--no-animation" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label
      className={baseClass}
      data-selected={selected}
      data-disabled={isDisabled}
      data-focus-visible={isFocusVisible}
    >
      {/* Hidden but focusable input */}
      <input
        ref={inputRef}
        type="checkbox"
        className="switch__input"
        name={name}
        value={value}
        checked={selected}
        disabled={isDisabled}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-checked={selected}
      />

      {/* Track (wrapper) */}
      <span className="switch__track">
        {startContent && <span className="switch__start">{startContent}</span>}
        <span className="switch__thumb">
          {thumbIcon && <span className="switch__thumb-icon">{thumbIcon}</span>}
        </span>
        {endContent && <span className="switch__end">{endContent}</span>}
      </span>

      {/* Label */}
      {labelText && <span className="switch__label">{labelText}</span>}
    </label>
  );
};

export default SwitchWithLabel;
