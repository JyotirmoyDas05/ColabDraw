import clsx from "clsx";
import { useEffect, useRef } from "react";

import { BAND_COUNT, voiceBands } from "../ai/voiceMeter";

import "./AIVoiceVisualizer.scss";

/**
 * Bars that follow the voice. Heights come straight from the microphone's (or
 * the model's) frequency bands, written to the DOM every frame so React never
 * re-renders for them.
 */
export const AIVoiceVisualizer = ({
  active,
  bars = 5,
  height = 24,
  source = "you",
  className,
}: {
  active: boolean;
  bars?: number;
  /** tallest a bar gets, in px */
  height?: number;
  /** whose voice the bars show; colors them differently */
  source?: "you" | "model";
  className?: string;
}) => {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let frame = 0;
    const group = Math.max(1, Math.floor(BAND_COUNT / bars));
    const tick = () => {
      frame = requestAnimationFrame(tick);
      for (let bar = 0; bar < bars; bar++) {
        let sum = 0;
        for (let band = 0; band < group; band++) {
          sum += voiceBands[Math.min(BAND_COUNT - 1, bar * group + band)];
        }
        const element = barRefs.current[bar];
        if (element) {
          // a quiet floor keeps the bars visible while nobody is talking
          element.style.height = `${Math.max(
            4,
            Math.round((sum / group) * height),
          )}px`;
        }
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active, bars, height]);

  return (
    <span
      className={clsx("ai-visualizer", className, {
        "ai-visualizer--active": active,
        "ai-visualizer--model": source === "model",
      })}
      style={
        {
          height,
          // 4px bars with 3px gaps
          "--ai-visualizer-width": `${bars * 7}px`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className="ai-visualizer__bar"
          ref={(element) => {
            barRefs.current[index] = element;
          }}
        />
      ))}
    </span>
  );
};
