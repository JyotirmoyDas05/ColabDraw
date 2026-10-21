import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import "./EmojiPicker.scss";

type Emoji = { emoji: string; label: string; tags: string[]; group: number };

// order follows emojibase's group numbers (group 2, "components", is skipped)
const GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: "Smileys & emotion", icon: "😀" },
  { id: 1, label: "People & body", icon: "👋" },
  { id: 3, label: "Animals & nature", icon: "🐻" },
  { id: 4, label: "Food & drink", icon: "🍔" },
  { id: 5, label: "Travel & places", icon: "🚀" },
  { id: 6, label: "Activities", icon: "⚽" },
  { id: 7, label: "Objects", icon: "💡" },
  { id: 8, label: "Symbols", icon: "❤️" },
  { id: 9, label: "Flags", icon: "🚩" },
];

const RECENT_KEY = "colabdraw-recent-icons";
const MAX_RECENT = 16;

const readRecent = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

let emojiPromise: Promise<Emoji[]> | null = null;

/** the whole emoji set, fetched the first time a picker opens */
const loadEmoji = () => {
  emojiPromise ??= import("emojibase-data/en/compact.json").then((module) =>
    (module.default as any[])
      .filter((entry) => entry.group !== undefined && entry.group !== 2)
      .map((entry) => ({
        emoji: entry.unicode as string,
        label: entry.label as string,
        tags: (entry.tags ?? []) as string[],
        group: entry.group as number,
      })),
  );
  return emojiPromise;
};

/** Pick any emoji: search by name, browse by category, recent ones first. */
export const EmojiPicker = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) => {
  const [all, setAll] = useState<Emoji[] | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(GROUPS[0].id);
  const [recent, setRecent] = useState(readRecent);

  useEffect(() => {
    loadEmoji().then(setAll);
  }, []);

  const shown = useMemo(() => {
    if (!all) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    if (needle) {
      return all
        .filter(
          (entry) =>
            entry.label.includes(needle) ||
            entry.tags.some((tag) => tag.includes(needle)),
        )
        .slice(0, 200);
    }
    return all.filter((entry) => entry.group === group);
  }, [all, query, group]);

  const pick = (emoji: string) => {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(
      0,
      MAX_RECENT,
    );
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // storage blocked: recents just won't stick
    }
    onChange(emoji);
  };

  const cell = (emoji: string, label: string) => (
    <button
      key={`${emoji}${label}`}
      type="button"
      className={clsx("colab-emoji__cell", { "is-active": emoji === value })}
      title={label}
      aria-label={label}
      onClick={() => pick(emoji)}
    >
      {emoji}
    </button>
  );

  return (
    <div className="colab-emoji">
      <input
        type="search"
        className="colab-emoji__search"
        placeholder="Search icons"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!query && (
        <div className="colab-emoji__tabs" role="tablist">
          {GROUPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === group}
              title={entry.label}
              className={clsx({ "is-active": entry.id === group })}
              onClick={() => setGroup(entry.id)}
            >
              {entry.icon}
            </button>
          ))}
        </div>
      )}
      <div className="colab-emoji__grid">
        {!all ? (
          <p className="colab-emoji__note">Loading icons…</p>
        ) : (
          <>
            {!query && recent.length > 0 && (
              <>
                <h4>Recent</h4>
                <div className="colab-emoji__row">
                  {recent.map((emoji) => cell(emoji, emoji))}
                </div>
              </>
            )}
            {!query && (
              <h4>{GROUPS.find((entry) => entry.id === group)?.label}</h4>
            )}
            <div className="colab-emoji__row">
              {shown.map((entry) => cell(entry.emoji, entry.label))}
            </div>
            {query && !shown.length && (
              <p className="colab-emoji__note">No icons match "{query}".</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
