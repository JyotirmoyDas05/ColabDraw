import { fail, readBytes } from "./http";

import type { Env } from "./types";

export const getFile = async (env: Env, fileId: string): Promise<Response> => {
  const object = await env.FILES.get(fileId);

  if (!object) {
    return fail(404, "not_found");
  }

  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag,
    },
  });
};

/**
 * File ids are content hashes, so re-uploading the same bytes is the same
 * object. Overwriting is therefore idempotent and needs no 409 branch.
 */
export const putFile = async (
  env: Env,
  fileId: string,
  request: Request,
): Promise<Response> => {
  const bytes = await readBytes(request);

  await env.FILES.put(fileId, bytes);

  return new Response(null, { status: 204 });
};
