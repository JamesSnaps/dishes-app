import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DbClient = ReturnType<typeof drizzle<typeof schema>>;

function createClient(): DbClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const connection = postgres(url, {
    max: process.env.NODE_ENV === "production" ? 10 : 3,
  });

  return drizzle(connection, { schema, logger: process.env.NODE_ENV === "development" });
}

// Singleton to avoid multiple connections during hot reload
declare global {
  // eslint-disable-next-line no-var
  var __db: DbClient | undefined;
}

function getDb(): DbClient {
  if (!globalThis.__db) {
    globalThis.__db = createClient();
  }
  return globalThis.__db;
}

/**
 * The transaction the current async context is running inside, if any.
 *
 * Every service in the app imports `db` directly rather than taking one as a
 * parameter. That is a good default — it keeps call sites clean — but it means
 * a caller has no way to say "run these two writes atomically" without
 * threading a transaction through every function in between. This closes that
 * gap: `runInTransaction` puts a transaction in the async context and the proxy
 * below routes `db` to it, so existing service code joins the transaction
 * unmodified.
 */
type Transaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const txContext = new AsyncLocalStorage<Transaction>();

// Lazy proxy — defers DB connection until first use so the module is safe to
// import during Next.js build without DATABASE_URL being set.
export const db = new Proxy({} as DbClient, {
  get(_, prop) {
    const target: DbClient | Transaction = txContext.getStore() ?? getDb();
    const value = target[prop as keyof typeof target];
    // Bound, so drizzle's internals resolve against whichever of the two this
    // actually is rather than against the proxy.
    return typeof value === "function" ? value.bind(target) : value;
  },
});

/**
 * Run `fn` inside a database transaction that every `db` call it makes — at any
 * depth, through any service — participates in.
 *
 * Nesting joins the outer transaction rather than opening a savepoint: callers
 * asking for atomicity want it relative to their own work, and a nested
 * rollback that left the outer transaction alive would be a surprising way to
 * hand back "this failed but some of it stuck".
 *
 * Keep the work inside short and database-only. The transaction holds a
 * connection from a small pool for its whole duration, so an AI call or an
 * upload in here would be a bad idea.
 */
export function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const existing = txContext.getStore();
  if (existing) return fn();

  return getDb().transaction((tx) => txContext.run(tx, fn));
}

export type Database = typeof db;
