import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "drizzle");

// Log which migration files are present so mismatches are obvious
const files = readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql"));
console.log(`Running database migrations... (found ${files.length} SQL file(s): ${files.join(", ")})`);

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder });
console.log("Migrations complete.");
await sql.end();
