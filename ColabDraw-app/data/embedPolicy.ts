import { getCollaborationLinkData } from "./index";

/**
 * Web embeds are limited to a short list of known sites. Each person can turn
 * that limit off per room ("Open web embeds" in the main menu); the choice is
 * theirs alone, so a collaborator can't switch it on for someone else.
 * Even when open, a few things stay blocked (see `canEmbed`).
 */

const STORAGE_KEY = "colabdraw-open-embed-rooms";
const LOCAL_BOARD = "local";

const BLOCKED_TLDS = ["xxx", "adult", "porn", "porno", "sex", "sexy"];

// Best effort, not a complete filter: well-known adult sites. Add more here.
const BLOCKED_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "spankbang.com",
  "brazzers.com",
  "onlyfans.com",
  "chaturbate.com",
  "stripchat.com",
  "e-hentai.org",
  "nhentai.net",
];

const roomKey = () =>
  getCollaborationLinkData(window.location.href)?.roomId ?? LOCAL_BOARD;

const openRooms = (): string[] => {
  try {
    const rooms = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(rooms) ? rooms : [];
  } catch {
    return [];
  }
};

export const areEmbedsOpen = () => openRooms().includes(roomKey());

export const setEmbedsOpen = (open: boolean) => {
  const rest = openRooms().filter((room) => room !== roomKey());
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(open ? [...rest, roomKey()] : rest),
    );
  } catch {
    // storage blocked: the toggle just won't stick
  }
};

/** https only, no internal-network addresses, no blocked sites. */
export const canEmbed = (url: string) => {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (
    host === "localhost" ||
    /\.(local|localhost|internal|lan)$/.test(host) ||
    host.includes(":") || // IPv6 literal
    /^\d+\.\d+\.\d+\.\d+$/.test(host) // IPv4 literal
  ) {
    return false;
  }
  if (BLOCKED_TLDS.includes(host.split(".").pop()!)) {
    return false;
  }
  return !BLOCKED_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
};

/**
 * For `<Excalidraw validateEmbeddable>`: returning undefined leaves the
 * default allowlist in charge, so it only takes over when embeds are open.
 */
export const validateEmbeddable = (url: string) =>
  areEmbedsOpen() ? canEmbed(url) : undefined;
