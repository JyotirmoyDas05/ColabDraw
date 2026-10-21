type Statement = { sql: string; args: unknown[] };

/**
 * A D1 stand-in that records the statements it is asked to run and replays a
 * scripted result. Enough to assert the SQL shape and the bound arguments
 * without pretending to be a database.
 */
export const fakeD1 = (seed: { first?: unknown; changes?: number } = {}) => {
  const statements: Statement[] = [];

  const prepare = (sql: string) => {
    const statement = {
      bind: (...args: unknown[]) => {
        statements.push({ sql, args });
        return statement;
      },
      first: async () => seed.first ?? null,
      run: async () => ({ meta: { changes: seed.changes ?? 1 } }),
      all: async () => ({ results: [] }),
    };

    return statement;
  };

  return { db: { prepare } as unknown as D1Database, statements };
};

/** An R2 stand-in backed by a Map, so byte round-trips are real. */
export const fakeR2 = () => {
  const objects = new Map<string, Uint8Array>();

  const bucket = {
    get: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) {
        return null;
      }
      return {
        body: new Blob([bytes]).stream(),
        httpEtag: `"${key}"`,
        size: bytes.byteLength,
      };
    },
    put: async (key: string, value: Uint8Array) => {
      objects.set(key, value);
      return { key };
    },
  };

  return { bucket: bucket as unknown as R2Bucket, objects };
};
