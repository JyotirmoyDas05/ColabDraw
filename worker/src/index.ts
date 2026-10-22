import { getFile, putFile } from "./files";
import { corsHeaders, fail, HttpError, isValidId } from "./http";
import { isRoomId } from "./protocol";
import { getScene, putScene } from "./scenes";
import { getShareLink, putShareLink } from "./shareLinks";
import { handleTrialGenerate, handleTrialStatus } from "./trial";

import type { Env } from "./types";

export { Room } from "./room";

const ROUTE = /^\/(scenes|share-links|files)\/([^/]+)$/;
const ROOM = /^\/rooms\/([^/]+)$/;

const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
};

const vercelPrefixes = new Set([
  "https://colab-draw-with-nextjs.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

/** Checked on upgrade because a 200 origin check after connect would leak the room. */
const isAllowedOrigin = (origin: string | null): boolean => {
  if (!origin) {
    return false;
  }
  if (vercelPrefixes.has(origin)) {
    return true;
  }
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host.endsWith(".vercel.app");
};

const handleRoom = (
  request: Request,
  env: Env,
  roomId: string,
): Response | Promise<Response> => {
  if (!isRoomId(roomId)) {
    return fail(404, "not_found");
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return fail(426, "upgrade_required");
  }
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return fail(403, "forbidden_origin");
  }
  return env.ROOMS.getByName(roomId).fetch(request);
};

const route = async (request: Request, env: Env): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (pathname === "/ai/trial") {
    if (request.method === "GET") {
      return handleTrialStatus(env, request);
    }
    return fail(405, "method_not_allowed");
  }

  if (pathname === "/ai/trial/generate") {
    if (request.method === "POST") {
      return handleTrialGenerate(env, request);
    }
    return fail(405, "method_not_allowed");
  }

  const match = ROUTE.exec(pathname);

  if (!match) {
    return fail(404, "not_found");
  }

  const [, resource, id] = match;

  if (!isValidId(id)) {
    return fail(404, "not_found");
  }

  if (request.method === "GET") {
    if (resource === "scenes") {
      return getScene(env, id);
    }
    if (resource === "share-links") {
      return getShareLink(env, id);
    }
    if (resource === "files") {
      return getFile(env, id);
    }
  }

  if (request.method === "PUT") {
    if (resource === "scenes") {
      return putScene(env, id, request);
    }
    if (resource === "share-links") {
      return putShareLink(env, id, request);
    }
    if (resource === "files") {
      return putFile(env, id, request);
    }
  }

  return fail(405, "method_not_allowed");
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const room = ROOM.exec(new URL(request.url).pathname);
    if (room) {
      // Returned untouched: a 101 response carries `webSocket`, and rebuilding
      // it inside `new Response` would drop that property.
      return handleRoom(request, env, room[1]);
    }

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      return withCors(await route(request, env));
    } catch (error) {
      if (error instanceof HttpError) {
        return withCors(fail(error.status, error.code));
      }
      console.error(error);
      return withCors(fail(500, "internal"));
    }
  },
};
