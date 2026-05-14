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

// Lazy proxy — defers DB connection until first use so the module is safe to
// import during Next.js build without DATABASE_URL being set.
export const db = new Proxy({} as DbClient, {
  get(_, prop) {
    return getDb()[prop as keyof DbClient];
  },
});

export type Database = typeof db;
