import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getRedis } from "@/lib/redis";
import { parseCrumbFile, type ParsedCrumbRecipe } from "@/lib/crumb-parser";

const SESSION_TTL_SECONDS = 900; // 15 minutes
const THUMBNAIL_SIZE = 120;
const THUMBNAIL_CONCURRENCY = 4;

export interface CrumbPreviewItem {
  index: number;
  title: string;
  ingredientCount: number;
  stepCount: number;
  cookTimeMinutes: number | null;
  servings: string | null;
  thumbnailDataUrl: string | null;
}

export interface CrumbPreviewResponse {
  sessionId: string | null;
  recipes: CrumbPreviewItem[];
}

async function makeThumbnail(base64: string | null): Promise<string | null> {
  if (!base64) return null;
  try {
    const buf = Buffer.from(base64, "base64");
    const thumb = await sharp(buf)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover" })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${thumb.toString("base64")}`;
  } catch {
    return null;
  }
}

async function parseCrumbs(content: ArrayBuffer, filename: string): Promise<ParsedCrumbRecipe[]> {
  if (filename.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(content);
    const crumbFiles = Object.values(zip.files).filter(
      (f) => !f.dir && f.name.toLowerCase().endsWith(".crumb")
    );
    if (crumbFiles.length === 0) throw new Error("No .crumb files found in zip");
    const results: ParsedCrumbRecipe[] = [];
    for (const file of crumbFiles) {
      try {
        const text = await file.async("text");
        results.push(parseCrumbFile(text));
      } catch {
        // Skip malformed entries silently
      }
    }
    return results;
  } else if (filename.toLowerCase().endsWith(".crumb")) {
    const text = new TextDecoder().decode(content);
    return [parseCrumbFile(text)];
  }
  throw new Error("Unsupported file type — upload a .crumb or .zip file");
}

export async function POST(req: NextRequest) {
  const user = await getAutheliaUser();
  await requireHousehold(user);

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  let parsed: ParsedCrumbRecipe[];
  try {
    const content = await file.arrayBuffer();
    parsed = await parseCrumbs(content, file.name);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse file" },
      { status: 400 }
    );
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: "No valid recipes found in file" }, { status: 400 });
  }

  // Build thumbnails in small batches to avoid OOM on large zips
  const redis = getRedis();
  const sessionId = randomUUID();

  const recipes: CrumbPreviewItem[] = [];
  for (let i = 0; i < parsed.length; i += THUMBNAIL_CONCURRENCY) {
    const batch = parsed.slice(i, i + THUMBNAIL_CONCURRENCY);
    const items = await Promise.all(
      batch.map(async (recipe, j) => ({
        index: i + j,
        title: recipe.title,
        ingredientCount: recipe.ingredients.length,
        stepCount: recipe.steps.length,
        cookTimeMinutes: recipe.cookTimeMinutes,
        servings: recipe.servings,
        thumbnailDataUrl: await makeThumbnail(recipe.imageBase64),
      }))
    );
    recipes.push(...items);
  }

  if (redis) {
    await redis.setex(
      `crumb-import:${sessionId}`,
      SESSION_TTL_SECONDS,
      JSON.stringify(parsed)
    );
  } else {
    // No Redis — embed full data in response so client can send it back
    return NextResponse.json({
      sessionId: null,
      recipes,
      // When sessionId is null, client must send fullData back on import
      fullData: parsed,
    } satisfies CrumbPreviewResponse & { fullData?: ParsedCrumbRecipe[] });
  }

  return NextResponse.json({ sessionId, recipes } satisfies CrumbPreviewResponse);
}
