import { NextResponse } from "next/server";
import { isNull, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { recipes } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, isStorageAvailable, keyFromUrl } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";

const log = createLogger("backfill-thumbnails");

export async function POST() {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  if (!isStorageAvailable()) {
    return NextResponse.json({ error: "S3 not configured." }, { status: 503 });
  }

  const pending = await db
    .select({ id: recipes.id, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        isNull(recipes.thumbnailUrl) as ReturnType<typeof isNull>
      )
    )
    .then((rows) => rows.filter((r) => r.imageUrl !== null)) as Array<{ id: string; imageUrl: string }>;

  log.info(`Backfill: ${pending.length} recipe(s) need thumbnails`);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const recipe of pending) {
    try {
      if (!keyFromUrl(recipe.imageUrl)) {
        results.push({ id: recipe.id, ok: false, error: "Image URL is not from configured storage" });
        continue;
      }
      const res = await fetch(recipe.imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
      const srcBuffer = Buffer.from(await res.arrayBuffer());

      const thumbBuffer = await makeThumbnail(srcBuffer);

      // Derive key prefix from the existing image URL so thumbnails land in
      // the same household folder without needing to re-query householdId.
      const existingKey = keyFromUrl(recipe.imageUrl);
      const folder = existingKey ? existingKey.split("/").slice(0, -1).join("/") : `recipes/${householdId}`;
      const key = `${folder}/${randomUUID()}_thumb.jpg`;

      const thumbnailUrl = await uploadFile(key, thumbBuffer, "image/jpeg");
      await db.update(recipes).set({ thumbnailUrl }).where(eq(recipes.id, recipe.id));

      results.push({ id: recipe.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Backfill failed for recipe ${recipe.id}:`, message);
      results.push({ id: recipe.id, ok: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  log.info(`Backfill complete: ${succeeded} succeeded, ${failed} failed`);
  return NextResponse.json({ total: pending.length, succeeded, failed, results });
}
