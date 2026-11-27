/**
 * Minimal SQL client abstraction so the store runs on:
 *  - node-postgres (`pg`) against a real PostgreSQL server: production, Vercel, CI;
 *  - PGlite (PostgreSQL compiled to WASM, in-process): local development and tests.
 * Both speak the same SQL dialect, so the schema, triggers and queries are identical.
 */
export interface Tx {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  /** Multi-statement script without parameters (simple query protocol). */
  exec(sql: string): Promise<void>;
}

export interface SqlClient extends Tx {
  readonly kind: "pg" | "pglite";
  /** Run `fn` in one transaction. Rolls back if it throws. */
  transaction<T>(fn: (tx: Tx) => Promise<T>, opts?: { readOnly?: boolean }): Promise<T>;
  /** Run a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * TLS for providers that sign with their own certificate authority (e.g. Supabase).
 * With DATABASE_CA_CERT (the provider's CA, PEM), the server certificate is verified against that CA
 * and the URL's sslmode is dropped (pg would otherwise let the URL override this config).
 * Without it, TLS settings come from the URL as parsed by pg (sslmode=verify-full = system CAs).
 */
export function pgConnectionConfig(url: string, env: NodeJS.ProcessEnv = process.env): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  const raw = env.DATABASE_CA_CERT?.trim();
  if (!raw) return { connectionString: url };
  const ca = raw.replace(/\\n/g, "\n"); // tolerate single-line values with escaped newlines
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("DATABASE_CA_CERT must be a PEM certificate (-----BEGIN CERTIFICATE----- …).");
  const u = new URL(url);
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

export async function pgClient(url: string, opts: { searchPath?: string } = {}): Promise<SqlClient> {
  const { Pool } = await import("pg");
  // Serverless: keep the pool small. Use the provider's pooled (PgBouncer/Supavisor) URL on Vercel.
  const pool = new Pool({
    ...pgConnectionConfig(url),
    max: Number(process.env.LANDED_PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    options: opts.searchPath ? `-c search_path=${opts.searchPath}` : undefined,
  });
  return {
    kind: "pg",
    query: async (text, params) => {
      const r = await pool.query(text, params as unknown[]);
      return { rows: r.rows };
    },
    transaction: async (fn, opts) => {
      const conn = await pool.connect();
      try {
        await conn.query(opts?.readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
        const tx: Tx = {
          query: async (t, p) => ({ rows: (await conn.query(t, p as unknown[])).rows }),
          exec: async (t) => {
            await conn.query(t);
          },
        };
        const out = await fn(tx);
        await conn.query("COMMIT");
        return out;
      } catch (e) {
        await conn.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        conn.release();
      }
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

export async function pgliteClient(dataDir: string | undefined): Promise<SqlClient> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    kind: "pglite",
    query: async (text, params) => {
      const r = await db.query(text, params as unknown[]);
      return { rows: r.rows as never[] };
    },
    // PGlite has a single connection and queues transactions, so they are serialised in-process.
    transaction: (fn, opts) =>
      db.transaction(async (t) => {
        if (opts?.readOnly) await t.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return fn({
          query: async (text, params) => ({ rows: (await t.query(text, params as unknown[])).rows as never[] }),
          exec: async (text) => {
            await t.exec(text);
          },
        });
      }),
    exec: async (sql) => {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

/**
 * Resolve the database from the environment.
 *   DATABASE_URL=postgres://…        real PostgreSQL (required in production)
 *   DATABASE_URL=pglite:memory       in-process, discarded on exit
 *   DATABASE_URL=pglite:./.data/pg   in-process, persisted to a directory (local development)
 *   (unset, not production)          pglite:./.data/pg
 */
export async function connectFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<SqlClient> {
  const url = env.DATABASE_URL ?? env.POSTGRES_URL ?? "";
  if (/^postgres(ql)?:\/\//.test(url)) return pgClient(url);
  const isProd = env.NODE_ENV === "production";
  if (url.startsWith("pglite:")) {
    if (env.VERCEL && env.LANDED_ALLOW_PGLITE !== "1") {
      throw new Error("PGlite is not supported on Vercel: its storage is per-instance and ephemeral. Set DATABASE_URL to a PostgreSQL URL.");
    }
    const target = url.slice("pglite:".length);
    return pgliteClient(target === "memory" ? undefined : target);
  }
  if (url) throw new Error("DATABASE_URL must be a postgres:// URL or pglite:<dir|memory>.");
  if (isProd) {
    const hint = env.SUPABASE_URL
      ? " SUPABASE_URL and the Supabase API keys are not a database connection: copy the Postgres connection string (Dashboard → Connect → Transaction pooler) into DATABASE_URL."
      : "";
    throw new Error(`DATABASE_URL is not set. Production requires PostgreSQL. Put it in .env.local (local) or the Vercel project settings; .env.example is never loaded.${hint}`);
  }
  return pgliteClient(".data/pg");
}
