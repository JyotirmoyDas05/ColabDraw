import { fail, json, readJson } from "./http";

import type { Env, ShareLinkRecord } from "./types";

type ShareLinkBody = { ciphertext?: unknown };

export const getShareLink = async (env: Env, id: string): Promise<Response> => {
  const row = await env.DB.prepare(
    "SELECT ciphertext FROM share_links WHERE id = ?",
  )
    .bind(id)
    .first<Pick<ShareLinkRecord, "ciphertext">>();

  if (!row) {
    return fail(404, "not_found");
  }

  return json({ ciphertext: row.ciphertext });
};

/**
 * Share-link ids are generated client-side, so a collision means the client is
 * reusing an id it already published. `DO NOTHING` + `meta.changes` reports that
 * as a 409 instead of throwing a constraint error.
 */
export const putShareLink = async (
  env: Env,
  id: string,
  request: Request,
): Promise<Response> => {
  const body = await readJson<ShareLinkBody>(request);

  if (
    !body ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length === 0
  ) {
    return fail(400, "bad_request");
  }

  const result = await env.DB.prepare(
    `INSERT INTO share_links (id, ciphertext, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(id, body.ciphertext, Date.now())
    .run();

  if (result.meta.changes === 0) {
    return fail(409, "conflict");
  }

  return new Response(null, { status: 201 });
};
