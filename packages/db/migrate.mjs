import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(sql);

console.log("Running database migrations...");
await migrate(db, { migrationsFolder: join(__dirname, "drizzle") });
console.log("Migrations complete.");
await sql.end();
