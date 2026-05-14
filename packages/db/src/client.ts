import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createClient() {
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
  var __db: ReturnType<typeof createClient> | undefined;
}

export const db = globalThis.__db ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__db = db;
}

export type Database = typeof db;
