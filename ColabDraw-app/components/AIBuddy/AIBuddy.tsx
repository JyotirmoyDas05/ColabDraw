import { motion, useReducedMotion, useSpring } from "framer-motion";
import { useEffect, useRef } from "react";

import "./AIBuddy.scss";

export type AIBuddyState =
  | "off"
  | "idle"
  | "listening"
  | "thinking"
  | "drawing"
  | "done"
  | "error";

export type AIBuddyProps = {
  state: AIBuddyState;
  size?: number;
  level?: number;
  lookAt?: { x: number; y: number } | null;
  followCursor?: boolean;
  className?: string;
  title?: string;
};

const MAX_LOOK = 7; // pupil travel in viewBox units
const SPRING = { stiffness: 220, damping: 18, mass: 0.6 };
const EYES = [36, 64];
const EYE_Y = 50;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

const bodyAnim = (state: AIBuddyState, level: number): any => {
  switch (state) {
    case "off":
      return {
        animate: { scale: [1, 1.04, 1] },
        transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
      };
    case "listening":
      return {
        animate: { scale: 1 + Math.min(Math.max(level, 0), 1) * 0.22 },
        transition: { type: "spring", stiffness: 300, damping: 14 },
      };
    case "thinking":
      return {
        animate: { rotate: [-6, 6, -6], scale: [1, 1.03, 1] },
        transition: { duration: 3, repeat: Infinity, ease: "easeInOut" },
      };
    case "done":
      return {
        animate: { y: [0, -12, 0, -5, 0] },
        transition: { duration: 0.9, ease: "easeOut" },
      };
    case "error":
      return {
        animate: { x: [0, -5, 5, -4, 4, 0] },
        transition: { duration: 0.5 },
      };
    default:
      return { animate: { scale: 1, x: 0, y: 0, rotate: 0 }, transition: {} };
  }
};

// eye glyphs centred on (cx, EYE_Y)
const chevron = (cx: number) =>
  `M${cx - 7} ${EYE_Y + 4} L${cx} ${EYE_Y - 5} L${cx + 7} ${EYE_Y + 4}`;
const cross = (cx: number) =>
  `M${cx - 6} ${EYE_Y - 6} L${cx + 6} ${EYE_Y + 6} M${cx + 6} ${EYE_Y - 6} L${
    cx - 6
  } ${EYE_Y + 6}`;
const closed = (cx: number) =>
  `M${cx - 7} ${EYE_Y} Q${cx} ${EYE_Y + 6} ${cx + 7} ${EYE_Y}`;

export const AIBuddy = ({
  state,
  size = 28,
  level = 0,
  lookAt = null,
  followCursor = true,
  className,
  title,
}: AIBuddyProps) => {
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const gx = useSpring(0, SPRING);
  const gy = useSpring(0, SPRING);
  const blink = useSpring(1, { stiffness: 500, damping: 30 });

  const aimAt = (px: number, py: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) {
      return;
    }
    const dx = px - (r.left + r.width / 2);
    const dy = py - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(dist / (r.width * 2 || 1), 1) * MAX_LOOK;
    gx.set((dx / dist) * k);
    gy.set((dy / dist) * k);
  };

  // static gaze per state, and lookAt tracking
  useEffect(() => {
    if (state === "thinking") {
      gx.set(MAX_LOOK);
      gy.set(-MAX_LOOK);
    } else if (state === "drawing" && lookAt) {
      aimAt(lookAt.x, lookAt.y);
    } else if (state !== "idle" || reduced) {
      gx.set(0);
      gy.set(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, lookAt?.x, lookAt?.y, reduced]);

  // single window pointer listener, idle only
  useEffect(() => {
    if (reduced || !followCursor || state !== "idle") {
      return;
    }
    const onMove = (e: PointerEvent) => aimAt(e.clientX, e.clientY);
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, followCursor, state]);

  // random blinks (idle/drawing) + glances (idle without cursor following)
  useEffect(() => {
    if (reduced || (state !== "idle" && state !== "drawing")) {
      blink.set(1);
      return;
    }
    const timers = new Set<number>();
    const loop = (min: number, max: number, fn: () => void) => {
      const tick = () => {
        fn();
        timers.add(window.setTimeout(tick, rand(min, max)));
      };
      timers.add(window.setTimeout(tick, rand(min, max)));
    };
    loop(2000, 5000, () => {
      blink.set(0.08);
      timers.add(window.setTimeout(() => blink.set(1), 120));
    });
    if (state === "idle" && !followCursor) {
      loop(1000, 3000, () => {
        gx.set(rand(-MAX_LOOK, MAX_LOOK));
        gy.set(rand(-MAX_LOOK, MAX_LOOK) * 0.7);
      });
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      blink.set(1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, state, followCursor]);

  const body = reduced
    ? { animate: {}, transition: {} }
    : bodyAnim(state, level);

  const glyph =
    state === "done"
      ? chevron
      : state === "error"
      ? cross
      : state === "off"
      ? closed
      : null;
  const rx = state === "listening" ? 8.5 : 6;
  const ry = state === "listening" ? 8.5 : 8;
  const squash = state === "thinking" ? 0.5 : 1;

  return (
    <span
      ref={rootRef}
      className={`ai-buddy${className ? ` ${className}` : ""}`}
      data-state={state}
      role="img"
      aria-label={title ?? "AI assistant"}
      title={title}
      style={{ width: size, height: size }}
    >
      <svg className="ai-buddy__svg" viewBox="0 0 100 100" aria-hidden="true">
        <motion.g
          style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
          animate={body.animate}
          transition={body.transition}
        >
          <path
            className="ai-buddy__body"
            d="M50 6C78 6 94 22 94 50S78 94 50 94 6 78 6 50 22 6 50 6Z"
          />
          <ellipse
            className="ai-buddy__highlight"
            cx="34"
            cy="22"
            rx="14"
            ry="7"
            transform="rotate(-25 34 22)"
          />
          {glyph ? (
            <g>
              {EYES.map((cx) => (
                <path key={cx} className="ai-buddy__eye-line" d={glyph(cx)} />
              ))}
            </g>
          ) : (
            <motion.g style={{ x: gx, y: gy }}>
              <motion.g
                style={{
                  scaleY: reduced ? squash : blink,
                  transformBox: "fill-box",
                  transformOrigin: "50% 50%",
                }}
              >
                <g
                  style={{
                    transform: `scaleY(${squash})`,
                    transformBox: "fill-box",
                    transformOrigin: "50% 50%",
                  }}
                >
                  {EYES.map((cx) => (
                    <ellipse
                      key={cx}
                      className="ai-buddy__eye"
                      cx={cx}
                      cy={EYE_Y}
                      rx={rx}
                      ry={ry}
                    />
                  ))}
                </g>
              </motion.g>
            </motion.g>
          )}
        </motion.g>
      </svg>
    </span>
  );
};
