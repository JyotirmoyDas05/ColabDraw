import type { LibraryItem } from "@excalidraw/excalidraw/types";

export type NamedLibraryItem = {
  name: string;
  description: string;
  item: LibraryItem;
};

const LIBRARY_ITEM_LIMIT = 60;

/** Library items with a usable name (the saved one, else its text) and a short description. */
export const describeLibraryItems = (
  items: readonly LibraryItem[],
  limit = LIBRARY_ITEM_LIMIT,
): NamedLibraryItem[] => {
  const used = new Set<string>();
  return items.slice(0, limit).map((item, index) => {
    const texts = item.elements
      .filter((element) => element.type === "text")
      .map((element) => (element as any).text.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const counts: Record<string, number> = {};
    for (const element of item.elements) {
      if (!(element.type === "text" && (element as any).containerId)) {
        counts[element.type] = (counts[element.type] ?? 0) + 1;
      }
    }
    let name = item.name?.trim() || texts[0] || `item ${index + 1}`;
    while (used.has(name.toLowerCase())) {
      name = `${name} (${index + 1})`;
    }
    used.add(name.toLowerCase());
    const parts = Object.entries(counts).map(([type, n]) =>
      n > 1 ? `${n} ${type}s` : type,
    );
    const description = `${parts.join(", ")}${
      texts.length ? `; text: ${texts.slice(0, 3).join(" / ")}` : ""
    }`;
    return { name, description: description.slice(0, 120), item };
  });
};

/** exact name, then partial, then the item sharing the most words with it */
export const findLibraryItem = <T extends { name: string }>(
  entries: readonly T[],
  wanted: string,
): T | undefined => {
  const query = wanted.trim().toLowerCase();
  if (!query) {
    return undefined;
  }
  const words = tokenize(query);
  const scored = entries
    .map((entry) => ({
      entry,
      score: tokenize(entry.name).filter((word) => words.includes(word)).length,
    }))
    .sort((a, b) => b.score - a.score);
  return (
    entries.find((entry) => entry.name.toLowerCase() === query) ??
    entries.find((entry) => entry.name.toLowerCase().includes(query)) ??
    entries.find((entry) => query.includes(entry.name.toLowerCase())) ??
    (scored[0]?.score ? scored[0].entry : undefined)
  );
};

// ---------------------------------------------------------------------------
// libraries.excalidraw.com, searched in the browser (no model call, no tokens)
// ---------------------------------------------------------------------------

const SITE = "https://libraries.excalidraw.com";
const FETCH_TIMEOUT_MS = 8000;

export type OnlineLibrary = {
  id: string;
  name: string;
  description: string;
  source: string;
  itemNames?: string[];
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "add",
  "make",
  "draw",
  "use",
  "put",
  "into",
  "that",
  "this",
  "these",
  "those",
  "some",
  "them",
  "its",
  "your",
  "can",
  "please",
  "show",
  "give",
  "new",
  "one",
  "two",
  "all",
  "any",
]);

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 3 ? word.replace(/s$/, "") : word));

// only search when the user is asking for ready-made art, so ordinary requests cost nothing
const ART_WORDS =
  /\b(librar(y|ies)|icons?|symbols?|stencils?|logos?|clip ?art|illustrations?|stickers?|pictograms?|emoji|sprites?)\b/i;

const ART_TOKENS = new Set([
  "library",
  "librarie",
  "icon",
  "symbol",
  "stencil",
  "logo",
  "clipart",
  "clip",
  "art",
  "illustration",
  "sticker",
  "pictogram",
  "emoji",
  "sprite",
  "installed",
  "online",
  "use",
  "using",
]);

const timedFetch = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

let indexPromise: Promise<OnlineLibrary[]> | null = null;

export const loadOnlineIndex = (): Promise<OnlineLibrary[]> => {
  indexPromise ??= timedFetch(`${SITE}/libraries.json`).catch(() => {
    indexPromise = null;
    return [];
  });
  return indexPromise;
};

const fileCache = new Map<string, Promise<LibraryItem[]>>();

/** all items of one online library */
export const loadOnlineLibraryItems = (
  library: OnlineLibrary,
): Promise<LibraryItem[]> => {
  let pending = fileCache.get(library.source);
  if (!pending) {
    pending = timedFetch(`${SITE}/libraries/${library.source}`)
      .then((file) =>
        (file.libraryItems ?? file.library ?? []).map(
          (entry: any, index: number): LibraryItem =>
            Array.isArray(entry)
              ? // v1 files are plain element arrays
                {
                  id: `${library.id}-${index}`,
                  status: "unpublished",
                  created: Date.now(),
                  elements: entry,
                }
              : entry,
        ),
      )
      .catch(() => {
        fileCache.delete(library.source);
        return [];
      });
    fileCache.set(library.source, pending);
  }
  return pending;
};

const MAX_LIBRARIES = 3;
const MAX_NAMES = 14;

/**
 * Online libraries that fit what the user asked for, as a short CANVAS section.
 * Empty (and free) unless the request is about ready-made art or names a library.
 */
export const onlineLibraryContext = async (userText: string) => {
  if (!ART_WORDS.test(userText)) {
    return "";
  }
  // the subject ("aws", "stick figure"), not the words that just say "icons"
  const words = [
    ...new Set(tokenize(userText).filter((word) => !ART_TOKENS.has(word))),
  ];
  if (!words.length) {
    return "";
  }
  const index = await loadOnlineIndex();
  const matches = index
    .map((library) => {
      const nameWords = tokenize(library.name);
      const nameScore = nameWords.filter((word) => words.includes(word)).length;
      const rest = tokenize(
        `${library.description} ${(library.itemNames ?? []).join(" ")}`,
      );
      const restScore = words.filter((word) => rest.includes(word)).length;
      return { library, nameScore, restScore };
    })
    .filter(({ nameScore, restScore }) => nameScore + restScore > 0)
    .sort(
      (a, b) => b.nameScore * 3 + b.restScore - (a.nameScore * 3 + a.restScore),
    )
    .slice(0, MAX_LIBRARIES);
  if (!matches.length) {
    return "";
  }
  const lines = matches.map(({ library }) => {
    const names = library.itemNames ?? [];
    const wanted = names.filter((name) =>
      tokenize(name).some((word) => words.includes(word)),
    );
    const shown = [...wanted, ...names.filter((n) => !wanted.includes(n))]
      .slice(0, MAX_NAMES)
      .map((name) => `"${name}"`)
      .join(", ");
    return `- "${library.name}": ${library.description.slice(0, 80)}${
      shown ? ` Items: ${shown}` : ""
    }`;
  });
  return `Online libraries (not installed; insert with insert_library_item using library and name, it is added to the user's library):\n${lines.join(
    "\n",
  )}`;
};

/** the library by name (from the index) and its best-matching item */
export const resolveOnlineItem = async (
  libraryName: string | undefined,
  itemName: string | undefined,
): Promise<{ library: OnlineLibrary; entry: NamedLibraryItem } | null> => {
  const index = await loadOnlineIndex();
  const library = libraryName
    ? findLibraryItem(index, libraryName)
    : index.find((candidate) =>
        (candidate.itemNames ?? []).some(
          (name) => name.toLowerCase() === itemName?.trim().toLowerCase(),
        ),
      );
  if (!library) {
    return null;
  }
  const items = describeLibraryItems(
    await loadOnlineLibraryItems(library),
    500,
  );
  const entry = itemName ? findLibraryItem(items, itemName) : items[0];
  return entry ? { library, entry } : null;
};
