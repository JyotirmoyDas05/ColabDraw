import { corsHeaders, fail, HttpError, isValidId } from "./http";
import { getScene, putScene } from "./scenes";

import type { Env } from "./types";

const ROUTE = /^\/(scenes|share-links|files)\/([^/]+)$/;

const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
};

const route = async (request: Request, env: Env): Promise<Response> => {
  const { pathname } = new URL(request.url);
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
  }

  if (request.method === "PUT") {
    if (resource === "scenes") {
      return putScene(env, id, request);
    }
  }

  return fail(405, "method_not_allowed");
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
