import React, { useMemo } from "react";

import "./PresentationFollowPill.scss";

interface PresentationFollowPillProps {
  presenterUsername: string;
  isFollowing: boolean;
  onToggleFollow: () => void;
}

/** Deterministic gradient based on username */
const getAvatarGradient = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [
    ["#ea4335", "#c5221f"], // Google red
    ["#4285f4", "#1a73e8"], // Google blue
    ["#34a853", "#1e8e3e"], // Google green
    ["#fbbc04", "#e37400"], // Google amber
    ["#9334e6", "#7928ca"], // Purple
    ["#0284c7", "#0369a1"], // Cyan/Sky
  ];
  const pair = hues[Math.abs(hash) % hues.length];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (name.slice(0, 2) || "H").toUpperCase();
};

export const PresentationFollowPill: React.FC<PresentationFollowPillProps> = ({
  presenterUsername,
  isFollowing,
  onToggleFollow,
}) => {
  const initials = useMemo(
    () => getInitials(presenterUsername),
    [presenterUsername],
  );
  const gradient = useMemo(
    () => getAvatarGradient(presenterUsername),
    [presenterUsername],
  );

  const labelText = isFollowing
    ? `Following ${presenterUsername}`
    : `Follow ${presenterUsername}`;

  return (
    <div
      className={`presentation-follow-pill ${
        isFollowing ? "is-following" : ""
      }`}
      onClick={onToggleFollow}
      role="button"
      tabIndex={0}
      title={labelText}
      aria-label={labelText}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleFollow();
        }
      }}
    >
      <div
        className="presentation-follow-pill__avatar"
        style={{ background: gradient }}
      >
        {initials}
        <span
          className="presentation-follow-pill__status-dot"
          aria-hidden="true"
        />
      </div>
      <span className="presentation-follow-pill__label">{labelText}</span>
    </div>
  );
};
