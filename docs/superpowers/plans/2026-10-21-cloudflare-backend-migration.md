# Cloudflare Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Appwrite Cloud backend with a Cloudflare Worker backed by D1 and R2, with no user-visible behaviour change.

**Architecture:** One Worker with a hand-written router (no framework, no runtime dependencies) exposing six routes over three resources. D1 stores encrypted scene documents and share-link payloads; R2 stores encrypted image bytes keyed by Excalidraw file id. The browser talks to it with plain `fetch`; there is no auth and the payloads are already encrypted client-side.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), R2, TypeScript, Vitest, `cf` CLI v0.15.0 for deploy/migrations, bun 1.3.4 for the repo.

**Spec:** `docs/superpowers/specs/2026-10-21-cloudflare-backend-migration-design.md`

## Global Constraints

- Ids match `^[A-Za-z0-9._-]{1,128}$`. Anything else is `404` before touching D1 or R2.
- JSON request bodies ≤ 10 MiB, file request bodies ≤ 8 MiB. Over the limit → `413`.
- Every response carries `access-control-allow-origin: *`. No `credentials`, no cookies, no auth.
- `OPTIONS` on any path → `204`.
- The Worker imports nothing at runtime. `worker/` adds no entry to `bun.lock` except the dev-only `@cloudflare/workers-types`.
- Deploy and resource commands use `cf`, never `wrangler` (wrangler is not authenticated here).
- Files stay Prettier-clean: `bun run test:other` must pass, which means `**/*.{css,scss,json,md,html,yml}` formatting.
- ESLint runs over the whole repo (`bun run test:code`), so worker sources must satisfy the existing `import/order` rules.
- Tests run under jsdom because `setupTests.ts` touches `document`. Do not add `@vitest-environment node` to worker tests.

## Review Focus

These are the failure modes a user will actually hit that no single route test obviously covers. Each has a test named in the task that owns the code.

1. **An oversized `PUT` body** (a 12 MiB JSON scene, a 9 MiB image) must return `413` without buffering the whole body first — Task 1 and Task 2.
2. **A malformed or hostile id** (`/files/a/b`, `/scenes/..%2Fetc%2Fpasswd`, a 200-character id) must `404`, never reach D1 with a surprising key — Task 1 and Task 2.
3. **`GET /files/:id` for a missing object** must return `404` _with_ CORS headers, otherwise the browser reports an opaque CORS failure and the app shows the wrong error — Task 2.
4. **Two `PUT /share-links/:id` calls for the same id** must yield `201` then `409`, not a `500` from a constraint violation — Task 2.
5. **The Worker being unreachable while saving** must reject `saveToBackend` so the collab UI reports an error, rather than swallowing the edit — Task 5.

---

### Task 1: Worker project, schema, and the scenes routes

**Files:**

- Create: `worker/wrangler.jsonc`
- Create: `worker/tsconfig.json`
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/src/types.ts`
- Create: `worker/src/http.ts`
- Create: `worker/src/scenes.ts`
- Create: `worker/src/index.ts`
- Create: `worker/tests/fakes.ts`
- Create: `worker/tests/scenes.test.ts`
- Modify: `package.json` (devDependency + `test:typecheck` script)

**Interfaces:**

- Consumes: nothing.
- Produces:

  - `worker/src/types.ts`: `type Env = { DB: D1Database; FILES: R2Bucket }`
  - `worker/src/http.ts`: `json(body: unknown, status?: number): Response`, `fail(status: number, code: string): Response`, `isValidId(id: string): boolean`, `readJson<T>(request: Request): Promise<T>`, `class HttpError extends Error { status: number; code: string }`, `MAX_JSON_BYTES: number`, `MAX_FILE_BYTES: number`, `corsHeaders: Record<string, string>`
  - `worker/src/scenes.ts`: `getScene(env: Env, roomId: string): Promise<Response>`, `putScene(env: Env, roomId: string, request: Request): Promise<Response>`
  - `worker/src/index.ts`: default export `{ fetch(request: Request, env: Env): Promise<Response> }`
  - `worker/tests/fakes.ts`: `fakeD1(seed?: { first?: unknown; changes?: number }): { db: D1Database; statements: { sql: string; args: unknown[] }[] }`, `fakeR2(): { bucket: R2Bucket; objects: Map<string, Uint8Array> }`

- [ ] **Step 1: Add the worker type dependency and typecheck script**

Run `bun add -d @cloudflare/workers-types` from the repo root, then change the script:

```json
"test:typecheck": "tsc && tsc -p worker/tsconfig.json"
```

Confirm `git diff --stat bun.lock` shows only the new package.

- [ ] **Step 2: Write the schema**

`worker/migrations/0001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS scenes (
  room_id       TEXT PRIMARY KEY,
  scene_version INTEGER NOT NULL,
  iv            TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id         TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 3: Write the failing scenes tests**

`worker/tests/scenes.test.ts` — `//` no environment docblock (see Global Constraints):

```ts
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { fakeD1, fakeR2 } from "./fakes";

const envWith = (opts: { first?: unknown; changes?: number } = {}) => {
  const d1 = fakeD1(opts);
  const r2 = fakeR2();
  return { env: { DB: d1.db, FILES: r2.bucket }, statements: d1.statements };
};

const put = (roomId: string, body: unknown) =>
  new Request(`https://api.test/scenes/${roomId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /scenes/:roomId", () => {
  it("returns the stored scene", async () => {
    const { env } = envWith({
      first: { scene_version: 7, iv: "aaa", ciphertext: "bbb" },
    });
    const res = await worker.fetch(
      new Request("https://api.test/scenes/abc123"),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      roomId: "abc123",
      sceneVersion: 7,
      iv: "aaa",
      ciphertext: "bbb",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("404s when no scene is stored", async () => {
    const { env } = envWith({ first: null });
    const res = await worker.fetch(
      new Request("https://api.test/scenes/nope"),
      env,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s for an id that is not url-safe, without querying D1", async () => {
    const { env, statements } = envWith({ first: null });
    const res = await worker.fetch(
      new Request("https://api.test/scenes/" + "x".repeat(200)),
      env,
    );
    expect(res.status).toBe(404);
    expect(statements).toHaveLength(0);
  });
});

describe("PUT /scenes/:roomId", () => {
  it("upserts and returns 204", async () => {
    const { env, statements } = envWith({ changes: 1 });
    const res = await worker.fetch(
      put("abc123", {
        roomId: "abc123",
        sceneVersion: 3,
        iv: "iv",
        ciphertext: "ct",
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/INSERT INTO scenes/i);
    expect(statements[0].sql).toMatch(/ON CONFLICT\(room_id\) DO UPDATE/i);
    expect(statements[0].args.slice(0, 4)).toEqual(["abc123", 3, "iv", "ct"]);
  });

  it("400s when the body is not a scene", async () => {
    const { env } = envWith({});
    const res = await worker.fetch(put("abc123", { roomId: "abc123" }), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("413s when the body declares more than 10 MiB", async () => {
    const { env } = envWith({});
    const request = new Request("https://api.test/scenes/abc123", {
      method: "PUT",
      headers: { "content-length": String(11 * 1024 * 1024) },
      body: "{}",
    });
    const res = await worker.fetch(request, env);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bunx vitest run worker/tests/scenes.test.ts` Expected: FAIL — `Cannot find module '../src/index'`.

- [ ] **Step 5: Implement `worker/src/types.ts` and `worker/src/http.ts`**

`types.ts` declares `Env`, `SceneRecord` (`{ room_id: string; scene_version: number; iv: string; ciphertext: string }`), and `ShareLinkRecord` (`{ id: string; ciphertext: string }`).

`http.ts`:

- `corsHeaders = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" }`
- `json(body, status = 200)` returns a `Response` with `content-type: application/json; charset=utf-8`.
- `fail(status, code)` returns `json({ error: code }, status)`.
- `isValidId` tests `/^[A-Za-z0-9._-]{1,128}$/`.
- `HttpError` carries `status` and `code`.
- `readJson<T>` throws `HttpError(413, "payload_too_large")` when `content-length` exceeds `MAX_JSON_BYTES`, reads `await request.text()`, throws the same error when the byte length exceeds the limit, throws `HttpError(400, "bad_request")` on a JSON parse error.

`MAX_JSON_BYTES = 10 * 1024 * 1024`, `MAX_FILE_BYTES = 8 * 1024 * 1024`.

- [ ] **Step 6: Implement `worker/src/scenes.ts`**

`getScene` runs `SELECT scene_version, iv, ciphertext FROM scenes WHERE room_id = ?` via `.bind(roomId).first<{ scene_version: number; iv: string; ciphertext: string }>()`. `null` → `fail(404, "not_found")`. Otherwise `json({ roomId, sceneVersion, iv, ciphertext })`.

`putScene` reads the body with `readJson`, rejects with `fail(400, "bad_request")` unless `sceneVersion` is a finite number and `iv`/`ciphertext` are non-empty strings, then runs:

```sql
INSERT INTO scenes (room_id, scene_version, iv, ciphertext, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(room_id) DO UPDATE SET
  scene_version = excluded.scene_version,
  iv = excluded.iv,
  ciphertext = excluded.ciphertext,
  updated_at = excluded.updated_at
```

bound to `[roomId, sceneVersion, iv, ciphertext, Date.now()]`, and returns `new Response(null, { status: 204 })`. The body's `roomId` is ignored; the path wins.

- [ ] **Step 7: Implement `worker/src/index.ts`**

A single `fetch(request, env)`:

1. `OPTIONS` → `204` with CORS.
2. Match `pathname` against `/^\/(scenes|share-links|files)\/([^/]+)$/`. No match → `fail(404, "not_found")`.
3. Reject an id failing `isValidId` with `fail(404, "not_found")`.
4. Dispatch on the resource and method; an unsupported method → `fail(405, "method_not_allowed")`.
5. Wrap the result so `corsHeaders` are merged into every response (`new Headers(res.headers)` + sets, then a new `Response` with the same body/status).
6. `catch (error)`: `HttpError` → `fail(error.status, error.code)`; anything else → `console.error(error)` and `fail(500, "internal")`. Both still get CORS.

Only `scenes` exists at this point; `share-links` and `files` fall through to `405` until Task 2.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bunx vitest run worker/tests/scenes.test.ts` Expected: PASS, 6 tests.

- [ ] **Step 9: Add `worker/wrangler.jsonc` and `worker/tsconfig.json`**

```jsonc
{
  "name": "colabdraw-backend",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-01",
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "colabdraw",
      "database_id": "PLACEHOLDER_REPLACE_AFTER_cf_d1_create"
    }
  ],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "colabdraw-files" }]
}
```

`worker/tsconfig.json` extends `../tsconfig.json` but overrides `compilerOptions.types` to `["@cloudflare/workers-types"]`, sets `"lib": ["ESNext"]` (no DOM), `"include": ["src/**/*.ts", "tests/**/*.ts"]`, and `"exclude": ["node_modules"]`.

- [ ] **Step 10: Typecheck and commit**

Run: `bun run test:typecheck` Expected: PASS (both `tsc` invocations).

```bash
git add worker package.json bun.lock
git commit -m "feat(worker): add Cloudflare Worker with D1-backed scenes routes"
```

---

### Task 2: Share-link and file routes, CORS and limits hardening

**Files:**

- Create: `worker/src/shareLinks.ts`
- Create: `worker/src/files.ts`
- Create: `worker/tests/shareLinks.test.ts`
- Create: `worker/tests/files.test.ts`
- Create: `worker/tests/router.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**

- Consumes: `Env`, `json`, `fail`, `isValidId`, `readJson`, `HttpError`, `MAX_FILE_BYTES`, `corsHeaders` from Task 1; `fakeD1`, `fakeR2` from Task 1.
- Produces: `getShareLink(env: Env, id: string): Promise<Response>`, `putShareLink(env: Env, id: string, request: Request): Promise<Response>`, `getFile(env: Env, fileId: string): Promise<Response>`, `putFile(env: Env, fileId: string, request: Request): Promise<Response>`.

- [ ] **Step 1: Write the failing share-link tests**

`worker/tests/shareLinks.test.ts`:

```ts
describe("GET /share-links/:id", () => {
  it("returns the stored ciphertext", async () => {
    // first: { ciphertext: "abc" }
    // expect 200 and { ciphertext: "abc" }
  });
  it("404s when absent", async () => {
    // first: null -> 404 { error: "not_found" }
  });
});

describe("PUT /share-links/:id", () => {
  it("creates and returns 201", async () => {
    // changes: 1 -> 201, SQL matches /INSERT INTO share_links/i, args[0] === id
  });
  it("409s when the id already exists", async () => {
    // changes: 0 -> 409 { error: "conflict" }
  });
  it("400s when ciphertext is missing", async () => {
    // body {} -> 400
  });
});
```

Fill in the assertions exactly as the scenes tests do (status, JSON body, statement SQL and args).

- [ ] **Step 2: Write the failing file tests**

`worker/tests/files.test.ts`:

```ts
describe("GET /files/:fileId", () => {
  it("returns the stored bytes", async () => {
    // objects.set("f1", new TextEncoder().encode("hello"))
    // expect 200, content-type application/octet-stream,
    // cache-control "public, max-age=31536000, immutable",
    // and new Uint8Array(await res.arrayBuffer()) equals the bytes
  });
  it("404s for a missing object and still sends CORS", async () => {
    // expect 404 and access-control-allow-origin "*"
  });
});

describe("PUT /files/:fileId", () => {
  it("stores the bytes and returns 204", async () => {
    // PUT body new TextEncoder().encode("hello") -> 204, objects.get("f1") matches
  });
  it("overwrites an existing object", async () => {
    // two PUTs, second body wins
  });
  it("413s when the body declares more than 8 MiB", async () => {
    // content-length 9 * 1024 * 1024 -> 413
  });
});
```

- [ ] **Step 3: Write the failing router tests**

`worker/tests/router.test.ts`:

```ts
describe("router", () => {
  it("answers OPTIONS with 204 and CORS", async () => {
    // OPTIONS /scenes/abc -> 204, allow-methods includes PUT
  });
  it("404s an unknown path", async () => {
    // GET /nope -> 404
  });
  it("404s a nested path instead of treating it as an id", async () => {
    // GET /files/a/b -> 404, and no R2 call
  });
  it("405s an unsupported method on a known resource", async () => {
    // DELETE /scenes/abc -> 405
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bunx vitest run worker/tests` Expected: FAIL — `share-links` and `files` return 405.

- [ ] **Step 5: Implement `worker/src/shareLinks.ts`**

`getShareLink` → `SELECT ciphertext FROM share_links WHERE id = ?`; `null` → `fail(404, "not_found")`; else `json({ ciphertext })`.

`putShareLink` → `readJson`, require a non-empty string `ciphertext`, then `INSERT INTO share_links (id, ciphertext, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING` bound to `[id, ciphertext, Date.now()]`. Read `meta.changes` from the `run()` result: `0` → `fail(409, "conflict")`, otherwise `new Response(null, { status: 201 })`.

- [ ] **Step 6: Implement `worker/src/files.ts`**

`getFile` → `await env.FILES.get(fileId)`; `null` → `fail(404, "not_found")`. Otherwise a `Response` with `object.body`, headers `content-type: application/octet-stream`, `cache-control: public, max-age=31536000, immutable`, and `etag` from `object.httpEtag`.

`putFile` → check `content-length` against `MAX_FILE_BYTES` (throw `HttpError(413, "payload_too_large")`), `const bytes = new Uint8Array(await request.arrayBuffer())`, check `bytes.byteLength` again, `await env.FILES.put(fileId, bytes)`, return `204`.

- [ ] **Step 7: Wire both resources into `worker/src/index.ts`**

Extend the dispatch switch: `GET`/`PUT` for `share-links` and `files`; everything else `405`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bunx vitest run worker/tests` Expected: PASS, all worker tests.

- [ ] **Step 9: Commit**

```bash
git add worker
git commit -m "feat(worker): add share-link and file routes"
```

---

### Task 3: Local end-to-end check against real D1 and R2

**Files:**

- Create: `worker/tests/e2e.mjs`
- Create: `worker/README.md`

**Interfaces:**

- Consumes: the running dev server on `http://localhost:8787`.
- Produces: `node worker/tests/e2e.mjs [baseUrl]` — exits `0` on success, `1` with a failing line otherwise.

- [ ] **Step 1: Write the script**

`worker/tests/e2e.mjs` is plain Node (not Vitest). It asserts, in order, printing `ok <name>` per assertion:

1. `OPTIONS /scenes/x` → `204` and `access-control-allow-origin: *`.
2. `GET /scenes/e2e` → `404`.
3. `PUT /scenes/e2e` with `{roomId:"e2e",sceneVersion:1,iv:"iv1",ciphertext:"ct1"}` → `204`.
4. `GET /scenes/e2e` → `200` with `sceneVersion: 1`.
5. `PUT /scenes/e2e` with `sceneVersion: 2` → `204`; `GET` → `200` with `sceneVersion: 2` (proves the upsert).
6. `PUT /share-links/e2e` → `201`; repeat → `409`; `GET` → `200` with the ciphertext.
7. `PUT /files/e2e` with the bytes of `"hello"` → `204`; `GET /files/e2e` → `200`, bytes equal, `cache-control` immutable; `GET /files/missing` → `404` with CORS.
8. `PUT /scenes/e2e` with a 11 MiB body → `413`.

- [ ] **Step 2: Run it against the dev server**

```bash
cd worker
npx wrangler d1 migrations apply DB --local
npx wrangler dev --local --port 8787   # in one shell
node tests/e2e.mjs                     # in another
```

Expected: eight `ok` lines, exit code 0.

If `cf dev` works in `worker/`, use it instead (`cf dev --port 8787`) — try `cf dev` first, fall back to `wrangler dev --local`, which needs no authentication. Note in `worker/README.md` which one worked.

- [ ] **Step 3: Write `worker/README.md`**

Cover: what the Worker is, the route table, the local loop (`migrations apply --local`, `dev`, `e2e.mjs`), the deploy loop (`cf d1 create`, `cf r2 buckets create`, `cf d1 migrations apply <id>`, `cf deploy`), and the fact that the API is unauthenticated and quota-bounded.

- [ ] **Step 4: Commit**

```bash
git add worker
git commit -m "test(worker): add local end-to-end check against D1 and R2"
```

---

### Task 4: Rename the client adapter to `data/backend.ts`

**Files:**

- Rename: `ColabDraw-app/data/appwrite.ts` → `ColabDraw-app/data/backend.ts`
- Modify: `ColabDraw-app/collab/Collab.tsx:79-84,166,174`
- Modify: `ColabDraw-app/App.tsx:116,541`
- Modify: `ColabDraw-app/app_constants.ts:33-36` (delete `FIREBASE_STORAGE_PREFIXES`)
- Modify: `ColabDraw-app/collab/Collab.tsx:59` and `ColabDraw-app/App.tsx:90` (drop the import)
- Modify: `ColabDraw-app/tests/base64.test.ts:3`
- Modify: `ColabDraw-app/tests/collab.test.tsx:30-49`

**Interfaces:**

- Consumes: `BACKEND_URL` from `import.meta.env.VITE_APP_BACKEND_URL`.
- Produces, all exported from `ColabDraw-app/data/backend.ts`:

  - `BACKEND_URL: string | undefined`
  - `isSavedToBackend(portal: Portal, elements: readonly ExcalidrawElement[]): boolean`
  - `saveToBackend(portal: Portal, elements: readonly SyncableExcalidrawElement[], appState: AppState): Promise<RemoteExcalidrawElement[] | null>`
  - `loadFromBackend(roomId: string, roomKey: string, socket: Socket | null): Promise<readonly SyncableExcalidrawElement[] | null>`
  - `saveFilesToBackend({ files }: { files: { id: FileId; buffer: Uint8Array }[] }): Promise<{ savedFiles: FileId[]; erroredFiles: FileId[] }>`
  - `loadFilesFromBackend(decryptionKey: string, filesIds: readonly FileId[]): Promise<{ loadedFiles: BinaryFileData[]; erroredFiles: Map<FileId, true> }>`
  - `bytesToBase64(bytes: Uint8Array): string`
  - `class BackendError extends Error { status: number }`
  - internal (not exported): `getStoredScene(roomId: string): Promise<StoredScene | null>`, `request(path: string, init?: RequestInit): Promise<Response>`

- [ ] **Step 1: Rename the file and its symbols**

`git mv ColabDraw-app/data/appwrite.ts ColabDraw-app/data/backend.ts`, then:

- Delete the `Client`/`Databases`/`Storage` imports and the `appwrite` package usage; delete `_getDatabase`, `_getStorage`, `_initializeAppwrite`, `loadAppwriteStorage`.
- Replace the six `APPWRITE_*` constants with `export const BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;`
- `AppwriteStoredScene` → `StoredScene`; `AppwriteSceneVersionCache` → `SceneVersionCache`; `createAppwriteSceneDocument` → `createSceneDocument`.
- Rename the five exported functions per the Interfaces block.

- [ ] **Step 2: Replace the Appwrite calls with `fetch`**

Add two private helpers:

```ts
const url = (path: string) => `${BACKEND_URL}${path}`;

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const res = await fetch(url(path), init);
  if (!res.ok) {
    throw new BackendError(
      res.status,
      `${init?.method ?? "GET"} ${path} failed`,
    );
  }
  return res;
};
```

- `saveToBackend`: keep the `!roomId || !roomKey || !socket || isSavedToBackend(...)` guard. Fetch the stored scene with `loadFromBackend`-style GET (reuse the module-level `getStoredScene(roomId)` that returns `StoredScene | null` and treats `404` as `null`). If a scene exists, decrypt + restore + reconcile as today; otherwise use `elements` unchanged. Then `PUT` once with `JSON.stringify(storedScene)`. Cache and return as today.
- `loadFromBackend`: `getStoredScene`, `null` → `null`, else decrypt/restore/cache as today.
- `saveFilesToBackend`: `PUT` each buffer to `/files/${id}` with `content-type: application/octet-stream`; any rejection pushes to `erroredFiles`. A `409` no longer needs special handling because `PUT` overwrites, so drop that branch.
- `loadFilesFromBackend`: `GET /files/${id}`; `404` or a thrown error → `erroredFiles.set(id, true)`; otherwise decompress exactly as today.
- `bytesToBase64` is unchanged.

- [ ] **Step 3: Update the call sites**

- `Collab.tsx`: import from `"../data/backend"`, use `loadFilesFromBackend(roomKey, fileIds)` and `saveFilesToBackend({ files: await encodeFilesForUpload(...) })`; rename `saveCollabRoomToAppwrite` → `saveCollabRoomToBackend`, `queueSaveToAppwrite` → `queueSaveToBackend`.
- `App.tsx`: import from `"../data/backend"`, call `loadFilesFromBackend(data.key, fileIds)`.
- Remove `FIREBASE_STORAGE_PREFIXES` from `app_constants.ts` and both importers.
- `tests/base64.test.ts`: import `bytesToBase64` from `"../data/backend"`.

- [ ] **Step 4: Repoint the collab test mock**

In `tests/collab.test.tsx`, change the mock path to `"../data/backend.ts"` and rename its keys to `loadFromBackend`, `saveToBackend`, `isSavedToBackend`, `loadFilesFromBackend`, `saveFilesToBackend`, keeping the stub shapes.

Note: the current path (`../../excalidraw-app/data/appwrite.ts`) does not resolve, so the mock has never been active. Run the test after the change. If reviving it breaks assertions, delete the mock block instead — letting the real module load is what happens today, and it is green.

- [ ] **Step 5: Pin the failure mode that matters — a dead backend must not look like an empty scene**

`ColabDraw-app/tests/backend.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadFromBackend } from "../data/backend";

afterEach(() => vi.unstubAllGlobals());

describe("loadFromBackend", () => {
  it("propagates a network failure instead of returning an empty scene", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(loadFromBackend("room", "key", null)).rejects.toThrow();
  });

  it("returns null for a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(loadFromBackend("room", "key", null)).resolves.toBeNull();
  });
});
```

A 404 means "no stored scene"; anything else must reject so `Collab` surfaces an error rather than letting the user draw into a room whose edits will never persist.

- [ ] **Step 6: Verify**

```bash
bunx vitest run ColabDraw-app/tests/collab.test.tsx ColabDraw-app/tests/base64.test.ts ColabDraw-app/tests/backend.test.ts
bun run test:typecheck
bun run test:code
```

Expected: all pass. `bun run test:code` must not report `appwrite` references left in `ColabDraw-app/`.

- [ ] **Step 7: Commit**

```bash
git add -A ColabDraw-app
git commit -m "refactor(app): replace the Appwrite adapter with a fetch-based backend client"
```

---

### Task 5: Share links through the adapter

**Files:**

- Modify: `ColabDraw-app/data/backend.ts` (add `readShareLink`, `createShareLink`)
- Modify: `ColabDraw-app/data/index.ts:184-320`
- Create: `ColabDraw-app/tests/shareLinkError.test.ts`

**Interfaces:**

- Consumes: `request`, `BackendError`, `BACKEND_URL` from Task 4.
- Produces:

  - `readShareLink(id: string): Promise<{ ciphertext: string } | null>`
  - `createShareLink(id: string, ciphertext: string): Promise<void>`
  - `describeShareLinkError(error: unknown): string` (newly exported from `data/index.ts`)

- [ ] **Step 1: Add the two adapter functions**

`readShareLink` — `GET /share-links/:id`, `404` → `null`, other non-2xx → `BackendError`, success → `res.json()`.

`createShareLink` — `PUT /share-links/:id` with `JSON.stringify({ ciphertext })` and `content-type: application/json`; non-2xx → `BackendError`.

- [ ] **Step 2: Write the failing error-mapping test**

`ColabDraw-app/tests/shareLinkError.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { describeShareLinkError } from "../data";

describe("describeShareLinkError", () => {
  it("reports a too-large payload for a 413", () => {
    const error = Object.assign(new Error("PUT /share-links/x failed"), {
      status: 413,
    });
    expect(describeShareLinkError(error)).toMatch(/too large|too big/i);
  });

  it("falls back to the generic message for a network failure", () => {
    expect(describeShareLinkError(new TypeError("Failed to fetch"))).toMatch(
      /couldn't create/i,
    );
  });
});
```

Match the real translation strings from `packages/ColabDraw/locales/en.json` (`alerts.couldNotCreateShareableLinkTooBig`, `alerts.couldNotCreateShareableLink`) when writing the regexes.

- [ ] **Step 3: Run it to verify it fails**

Run: `bunx vitest run ColabDraw-app/tests/shareLinkError.test.ts` Expected: FAIL — `describeShareLinkError` is not exported.

- [ ] **Step 4: Rewrite the share-link flow in `data/index.ts`**

- Drop the `_getDatabase`, `APPWRITE_DATABASE_ID`, `APPWRITE_SHARE_LINKS_TABLE_ID` imports; import `readShareLink`, `createShareLink`, `saveFilesToBackend`, `bytesToBase64`, `BACKEND_URL` from `"./backend"`.
- `importFromBackend`: `const doc = await readShareLink(id)`; `null` → alert + `{}`; else base64-decode `doc.ciphertext` and continue unchanged.
- `exportToBackend`: the guard becomes `if (!BACKEND_URL) { return { url: null, errorMessage: t("alerts.shareLinkNotConfigured") }; }`. Replace `database.createDocument(...)` with `await createShareLink(id, ciphertextBase64)`, and `saveFilesToAppwrite({ prefix, files })` with `saveFilesToBackend({ files: filesToUpload })`.
- Export `describeShareLinkError`, and simplify it to: `413` or the byte-length message → too big; everything else → `t("alerts.couldNotCreateShareableLink")`. Delete the `Invalid Origin` and `402`/billing branches — they are Appwrite concepts. Leave the now-unused `alerts.shareLinkOriginNotAllowed` / `alerts.shareLinkStorageFull` locale keys in place.
- Update the trailing re-export to `export { loadFilesFromBackend, saveFilesToBackend } from "./backend";`.

- [ ] **Step 5: Run the tests and lint**

```bash
bunx vitest run ColabDraw-app/tests/shareLinkError.test.ts
bun run test:typecheck
bun run test:code
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ColabDraw-app
git commit -m "feat(app): store share links through the backend client"
```

---

### Task 6: Environment, dependencies, and docs

**Files:**

- Modify: `.env.development`, `.env.development.example`, `.env.production`, `.env.production.example`
- Modify: `ColabDraw-app/vite-env.d.ts:20-26`
- Modify: `ColabDraw-app/package.json` (remove `appwrite`)
- Modify: `package.json` (remove `node-appwrite`)
- Modify: `DEPLOYMENT.md:85-95,205-212`
- Modify: `README.md:88,109,158`
- Modify: `START.md:95-102,200-206`

- [ ] **Step 1: Swap the env vars**

In all four env files, delete the six `VITE_APP_APPWRITE_*` lines and their comment, and add:

```
# Cloudflare Worker backend (see worker/README.md)
VITE_APP_BACKEND_URL=http://localhost:8787
```

for `.env.development*`, and for `.env.production*`:

```
# Cloudflare Worker backend (see worker/README.md)
VITE_APP_BACKEND_URL=https://colabdraw-backend.<account-subdomain>.workers.dev
```

Leave the production value as the literal placeholder until Task 7 prints the real URL.

- [ ] **Step 2: Update the env typings**

In `ColabDraw-app/vite-env.d.ts`, replace the six `VITE_APP_APPWRITE_*` declarations with `VITE_APP_BACKEND_URL: string;` and fix the comment above them.

- [ ] **Step 3: Drop the dependencies**

Remove `"appwrite"` from `ColabDraw-app/package.json` and `"node-appwrite"` from the root `package.json` (grep confirms nothing imports `node-appwrite`). Run `bun install` and confirm `bun.lock` drops both.

- [ ] **Step 4: Update the docs**

- `DEPLOYMENT.md`: replace the Appwrite env block with `VITE_APP_BACKEND_URL`, and change the services table row to `Cloudflare Workers + D1 + R2 — free tier, no egress`.
- `README.md`: swap "Appwrite" for "Cloudflare" in the feature list, the setup step, and the backend line.
- `START.md`: same swap in the env block and the two flow descriptions.

- [ ] **Step 5: Verify nothing references Appwrite**

```bash
git grep -in "appwrite" -- ":!docs/" ":!coverage/"
```

Expected: no output. (`docs/superpowers/specs/` legitimately mentions it.)

- [ ] **Step 6: Format, lint, and commit**

```bash
bun run test:other
bun run test:code
git add -A
git commit -m "chore: point the app at the Cloudflare backend and drop Appwrite"
```

---

### Task 7: Create the resources, deploy, and verify production

**Files:**

- Modify: `worker/wrangler.jsonc` (real `database_id`)
- Modify: `.env.production`, `.env.production.example` (real Worker URL)

- [ ] **Step 1: Create D1 and R2**

```bash
cf d1 create --name colabdraw
cf r2 buckets create --name colabdraw-files
```

Capture the database id from the first command and put it in `worker/wrangler.jsonc`.

- [ ] **Step 2: Apply the migration remotely**

```bash
cd worker
cf d1 migrations apply <database-id> --dir migrations
```

Expected: `0001_init.sql` applied. Confirm with `cf d1 query <database-id> "SELECT name FROM sqlite_master WHERE type='table'"` → `scenes`, `share_links`.

- [ ] **Step 3: Deploy the Worker**

`cf deploy` cannot be used: it requires `worker/package.json` to declare `wrangler` as a devDependency, and adding that dependency is ruled out by the Global Constraints. Export the OAuth token `cf` already stores and deploy with `wrangler`:

```powershell
$cfg = Get-Content "$env:APPDATA\xdg.config\cloudflare\config\default.json" -Raw | ConvertFrom-Json
$env:CLOUDFLARE_API_TOKEN = $cfg.oauth_token
cd worker
npx wrangler deploy
```

Expected: a `https://colabdraw-backend.<subdomain>.workers.dev` URL. `wrangler whoami` with that variable set was verified to authenticate as `jyotimoydas12345@gmail.com` (account `649f61080067899dd8ab5149c15c44b6`).

- [ ] **Step 4: Run the e2e script against production**

```bash
node worker/tests/e2e.mjs https://colabdraw-backend.<subdomain>.workers.dev
```

Expected: eight `ok` lines. This writes a few throwaway rows (`e2e` scene, `e2e` share link, `e2e` file) — delete them afterwards with `cf d1 query <database-id> "DELETE FROM scenes WHERE room_id='e2e'"` and the same for `share_links`, plus `cf r2 object delete colabdraw-files/e2e` if the CLI supports it (otherwise leave the 5-byte object).

- [ ] **Step 5: Point production at it**

Set the real URL in `.env.production` and `.env.production.example`, then in Vercel: add `VITE_APP_BACKEND_URL`, delete the six `VITE_APP_APPWRITE_*` variables, redeploy.

Rollback if anything is wrong: revert this branch's app commits and redeploy Vercel. The Worker, D1 database and R2 bucket stay in place, unused and free.

- [ ] **Step 6: Verify the deployed app**

Open two tabs on the same room, draw, add an image, reload one tab: the scene and image return. Create a share link, open it in a private window: the scene renders.

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A
git commit -m "chore(worker): point production at the deployed backend"
git push -u origin feat/cloudflare-backend
gh pr create --base main --title "feat: move the backend to Cloudflare Workers, D1 and R2" --body "..."
```

Link the PR to the thread with `link_pull_request`.
