/**
 * Proves that browsing a shared library and importing from it agree about what
 * is visible.
 *
 * This is the guard behind the rule in `lib/services/library-share-scope.ts`:
 * import authorisation must be a *use* of the browse predicate, never a
 * reimplementation. If someone adds a filter to one path and not the other,
 * this fails.
 *
 * It seeds a throwaway owner household with recipes spread across collections
 * and tags, walks every base-scope × exclude-tags permutation, and asserts for
 * each that the set of ids the browse query returns is exactly the set
 * `assertRecipesInScope` will authorise — and that anything outside that set is
 * refused.
 *
 * Usage (from apps/web, against the dev stack):
 *   npx tsx scripts/check-share-scope.ts
 *
 * Creates and then deletes its own households; it does not touch existing data.
 */

import { db } from "@/lib/db";
import {
  collections,
  households,
  householdMembers,
  libraryShareCollections,
  libraryShareTags,
  libraryShares,
  recipeCollections,
  recipeTags,
  recipes,
} from "@dishes/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  assertRecipesInScope,
  loadShareScope,
  shareScopePredicate,
  LibraryShareInvalidError,
  type ShareBaseScope,
} from "@/lib/services/library-share-scope";

const SLUG_OWNER = "scope-check-owner";
const SLUG_GRANTEE = "scope-check-grantee";

type Seeded = {
  ownerId: string;
  granteeId: string;
  shareId: string;
  recipeIds: Record<string, string>;
  collectionIds: Record<string, string>;
};

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup() {
  const rows = await db
    .select({ id: households.id })
    .from(households)
    .where(inArray(households.slug, [SLUG_OWNER, SLUG_GRANTEE]));
  if (rows.length) {
    // Everything else cascades from households.
    await db.delete(households).where(inArray(households.id, rows.map((r) => r.id)));
  }
}

async function seed(): Promise<Seeded> {
  const [owner] = await db
    .insert(households)
    .values({ name: "Scope Check Owner", slug: SLUG_OWNER })
    .returning({ id: households.id });
  const [grantee] = await db
    .insert(households)
    .values({ name: "Scope Check Grantee", slug: SLUG_GRANTEE })
    .returning({ id: households.id });

  const [granteeMember] = await db
    .insert(householdMembers)
    .values({
      householdId: grantee!.id,
      autheliaUser: "scope-check-grantee-user",
      displayName: "Scope Check",
      role: "admin",
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: householdMembers.id });

  // Two collections, and recipes arranged so every permutation has both a
  // member and a non-member, and so exclude overlaps include.
  const [weeknight] = await db
    .insert(collections)
    .values({ householdId: owner!.id, name: "Weeknight" })
    .returning({ id: collections.id });
  const [baking] = await db
    .insert(collections)
    .values({ householdId: owner!.id, name: "Baking" })
    .returning({ id: collections.id });

  const spec: { key: string; collections: string[]; tags: string[] }[] = [
    { key: "plain", collections: [], tags: [] },
    { key: "weeknightOnly", collections: ["weeknight"], tags: ["quick"] },
    { key: "bakingOnly", collections: ["baking"], tags: ["sweet"] },
    { key: "bothCollections", collections: ["weeknight", "baking"], tags: ["quick", "sweet"] },
    // The critical one: in a shared collection AND carrying an excluded tag.
    { key: "weeknightExcluded", collections: ["weeknight"], tags: ["quick", "untested"] },
    { key: "taggedExcludedOnly", collections: [], tags: ["untested"] },
    { key: "quickAndExcluded", collections: [], tags: ["quick", "untested"] },
  ];

  const collectionIds = { weeknight: weeknight!.id, baking: baking!.id };
  const recipeIds: Record<string, string> = {};

  for (const item of spec) {
    const [row] = await db
      .insert(recipes)
      .values({ householdId: owner!.id, title: `Scope check — ${item.key}` })
      .returning({ id: recipes.id });
    recipeIds[item.key] = row!.id;

    for (const c of item.collections) {
      await db
        .insert(recipeCollections)
        .values({ collectionId: collectionIds[c as keyof typeof collectionIds], recipeId: row!.id });
    }
    for (const tag of item.tags) {
      await db.insert(recipeTags).values({ recipeId: row!.id, tag });
    }
  }

  // A recipe in a *different* household, to prove the household anchor holds.
  await db.insert(recipes).values({ householdId: grantee!.id, title: "Grantee's own recipe" });

  const [share] = await db
    .insert(libraryShares)
    .values({
      ownerHouseholdId: owner!.id,
      granteeHouseholdId: grantee!.id,
      createdById: null,
      redeemedByMemberId: granteeMember!.id,
      redeemedAt: new Date(),
      inviteCode: `scope-check-${Date.now()}`,
      baseScope: "all",
      excludeTags: [],
    })
    .returning({ id: libraryShares.id });

  return {
    ownerId: owner!.id,
    granteeId: grantee!.id,
    shareId: share!.id,
    recipeIds,
    collectionIds,
  };
}

/** Point the share at a given scope, the way the owner's editor would. */
async function setScope(
  s: Seeded,
  baseScope: ShareBaseScope,
  opts: { collections?: string[]; includeTags?: string[]; excludeTags?: string[] }
) {
  await db
    .update(libraryShares)
    .set({ baseScope, excludeTags: opts.excludeTags ?? [] })
    .where(eq(libraryShares.id, s.shareId));

  await db.delete(libraryShareCollections).where(eq(libraryShareCollections.shareId, s.shareId));
  await db.delete(libraryShareTags).where(eq(libraryShareTags.shareId, s.shareId));

  for (const c of opts.collections ?? []) {
    await db.insert(libraryShareCollections).values({
      shareId: s.shareId,
      collectionId: s.collectionIds[c]!,
    });
  }
  for (const tag of opts.includeTags ?? []) {
    await db.insert(libraryShareTags).values({ shareId: s.shareId, tag });
  }
}

async function browseIds(s: Seeded): Promise<string[]> {
  const scope = await loadShareScope(s.granteeId, s.shareId);
  const rows = await db.select({ id: recipes.id }).from(recipes).where(shareScopePredicate(scope));
  return rows.map((r) => r.id).sort();
}

/** Every recipe the owner has, whether in scope or not. */
async function allOwnerRecipeIds(s: Seeded): Promise<string[]> {
  const rows = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(eq(recipes.householdId, s.ownerId));
  return rows.map((r) => r.id);
}

async function runCase(
  s: Seeded,
  label: string,
  baseScope: ShareBaseScope,
  opts: { collections?: string[]; includeTags?: string[]; excludeTags?: string[] },
  expectedKeys: string[]
) {
  console.log(`\n${label}`);
  await setScope(s, baseScope, opts);

  const visible = await browseIds(s);
  const expected = expectedKeys.map((k) => s.recipeIds[k]!).sort();

  check(
    `browse returns the expected ${expected.length} recipe(s)`,
    JSON.stringify(visible) === JSON.stringify(expected),
    `got ${visible.length}: ${visible.map(nameOf(s)).join(", ")} | expected: ${expectedKeys.join(", ")}`
  );

  // The whole point: import must authorise exactly what browse shows.
  const scope = await loadShareScope(s.granteeId, s.shareId);
  if (visible.length) {
    try {
      const authorised = await assertRecipesInScope(scope, visible);
      check(
        "import authorises every browsable recipe",
        authorised.length === visible.length
      );
    } catch {
      check("import authorises every browsable recipe", false, "threw");
    }
  }

  // And must refuse everything else the owner has.
  const hidden = (await allOwnerRecipeIds(s)).filter((id) => !visible.includes(id));
  for (const id of hidden) {
    let refused = false;
    try {
      await assertRecipesInScope(scope, [id]);
    } catch (err) {
      refused = err instanceof LibraryShareInvalidError;
    }
    check(`import refuses hidden recipe ${nameOf(s)(id)}`, refused);
  }
}

function nameOf(s: Seeded) {
  const byId = Object.fromEntries(Object.entries(s.recipeIds).map(([k, v]) => [v, k]));
  return (id: string) => byId[id] ?? id.slice(0, 8);
}

async function main() {
  await cleanup();
  const s = await seed();

  try {
    await runCase(s, "base: all", "all", {}, [
      "plain",
      "weeknightOnly",
      "bakingOnly",
      "bothCollections",
      "weeknightExcluded",
      "taggedExcludedOnly",
      "quickAndExcluded",
    ]);

    await runCase(s, "base: all, exclude 'untested'", "all", { excludeTags: ["untested"] }, [
      "plain",
      "weeknightOnly",
      "bakingOnly",
      "bothCollections",
    ]);

    await runCase(s, "base: collections [Weeknight]", "collections", { collections: ["weeknight"] }, [
      "weeknightOnly",
      "bothCollections",
      "weeknightExcluded",
    ]);

    await runCase(
      s,
      "base: collections [Weeknight], exclude 'untested' — exclude must win",
      "collections",
      { collections: ["weeknight"], excludeTags: ["untested"] },
      ["weeknightOnly", "bothCollections"]
    );

    await runCase(s, "base: tags ['quick']", "tags", { includeTags: ["quick"] }, [
      "weeknightOnly",
      "bothCollections",
      "weeknightExcluded",
      "quickAndExcluded",
    ]);

    await runCase(
      s,
      "base: tags ['quick'], exclude 'untested'",
      "tags",
      { includeTags: ["quick"], excludeTags: ["untested"] },
      ["weeknightOnly", "bothCollections"]
    );

    // Fail closed: an include selector emptied out must expose nothing, not
    // silently fall back to the whole library.
    await runCase(s, "base: collections, none selected — must expose nothing", "collections", {}, []);
    await runCase(s, "base: tags, none selected — must expose nothing", "tags", {}, []);

    // Revocation kills the grant outright.
    console.log("\nrevoked share");
    await db
      .update(libraryShares)
      .set({ revokedByOwnerAt: new Date() })
      .where(eq(libraryShares.id, s.shareId));
    let threw = false;
    try {
      await loadShareScope(s.granteeId, s.shareId);
    } catch (err) {
      threw = err instanceof LibraryShareInvalidError;
    }
    check("a revoked share can no longer be loaded", threw);
  } finally {
    await cleanup();
  }

  console.log(
    failures === 0
      ? "\nAll scope checks passed — browse and import agree.\n"
      : `\n${failures} check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
