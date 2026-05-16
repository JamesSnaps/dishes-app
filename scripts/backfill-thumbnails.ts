/**
 * One-time script to generate 400px JPEG thumbnails for all recipes that have
 * an imageUrl but no thumbnailUrl.
 *
 * Usage (from the monorepo root):
 *   DATABASE_URL=... S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
 *     npx tsx scripts/backfill-thumbnails.ts
 *
 * Or run inside the running container:
 *   docker exec -it dishes-web npx tsx scripts/backfill-thumbnails.ts
 *
 * Safe to re-run — skips recipes that already have thumbnailUrl set.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { isNull, isNotNull, eq } from "drizzle-orm";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

// Inline minimal schema reference to avoid Next.js module resolution issues
import { recipes } from "../packages/db/src/schema/recipes";

const DATABASE_URL = process.env.DATABASE_URL;
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  throw new Error("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY are all required");
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  forcePathStyle: true,
});

async function uploadThumbnail(key: string, buffer: Buffer): Promise<string> {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg",
  }));
  const base = S3_PUBLIC_URL ?? S3_ENDPOINT;
  return `${base}/${S3_BUCKET}/${key}`;
}

async function run() {
  const pending = await db
    .select({ id: recipes.id, imageUrl: recipes.imageUrl, householdId: recipes.householdId })
    .from(recipes)
    .where(isNull(recipes.thumbnailUrl) && isNotNull(recipes.imageUrl) as never);

  // Filter out rows where imageUrl is actually null (drizzle type is string | null)
  const todo = pending.filter((r): r is typeof r & { imageUrl: string } => r.imageUrl !== null);

  console.log(`Found ${todo.length} recipe(s) needing thumbnails.`);
  if (todo.length === 0) { await pool.end(); return; }

  let done = 0;
  let failed = 0;

  for (const recipe of todo) {
    try {
      process.stdout.write(`  [${done + failed + 1}/${todo.length}] ${recipe.id} … `);

      const res = await fetch(recipe.imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${recipe.imageUrl}`);
      const srcBuffer = Buffer.from(await res.arrayBuffer());

      const thumbBuffer = await sharp(srcBuffer)
        .resize(400, null, { withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const key = `recipes/${recipe.householdId}/${randomUUID()}_thumb.jpg`;
      const thumbnailUrl = await uploadThumbnail(key, thumbBuffer);

      await db.update(recipes).set({ thumbnailUrl }).where(eq(recipes.id, recipe.id));

      done++;
      console.log(`✓ ${thumbnailUrl}`);
    } catch (err) {
      failed++;
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone: ${done} succeeded, ${failed} failed.`);
  await pool.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
