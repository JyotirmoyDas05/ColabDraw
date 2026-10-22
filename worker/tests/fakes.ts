type Statement = { sql: string; args: unknown[] };

/**
 * A D1 stand-in that records the statements it is asked to run and replays a
 * scripted result. Enough to assert the SQL shape and the bound arguments
 * without pretending to be a database.
 */
export const fakeD1 = (
  seed: { first?: unknown; changes?: number; all?: unknown[] } = {},
) => {
  const statements: Statement[] = [];

  const prepare = (sql: string) => {
    const statement = {
      bind: (...args: unknown[]) => {
        statements.push({ sql, args });
        return statement;
      },
      first: async () => seed.first ?? null,
      run: async () => ({ meta: { changes: seed.changes ?? 1 } }),
      all: async () => ({ results: seed.all ?? [] }),
    };

    return statement;
  };

  return { db: { prepare } as unknown as D1Database, statements };
};

/** An R2 stand-in backed by a Map, so byte round-trips are real. */
export const fakeR2 = () => {
  const objects = new Map<string, Uint8Array>();
  const calls = { get: 0, put: 0 };

  const bucket = {
    get: async (key: string) => {
      calls.get += 1;
      const bytes = objects.get(key);
      if (!bytes) {
        return null;
      }
      return {
        body: new Response(bytes).body,
        httpEtag: `"${key}"`,
        size: bytes.byteLength,
      };
    },
    put: async (key: string, value: Uint8Array) => {
      calls.put += 1;
      objects.set(key, value);
      return { key };
    },
  };

  return { bucket: bucket as unknown as R2Bucket, objects, calls };
};

/**
 * A Durable Object namespace stand-in. The REST routes never open one, so any
 * attempt to reach one from these tests is a mistake worth failing loudly.
 */
export const fakeRooms = () =>
  ({
    getByName: () => {
      throw new Error("Room Durable Objects are not faked; use worker tests");
    },
  } as unknown as DurableObjectNamespace);

/**
 * A request whose body arrives as a stream, so it carries no `content-length`.
 * This is the shape a chunked upload has, and the only way to exercise the
 * measured size check rather than the declared one.
 */
export const streamedRequest = (
  url: string,
  chunks: Uint8Array[],
  init: RequestInit,
) =>
  new Request(url, {
    ...init,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    // Node's fetch needs this for a stream body; workerd does not.
    duplex: "half",
  } as RequestInit);
