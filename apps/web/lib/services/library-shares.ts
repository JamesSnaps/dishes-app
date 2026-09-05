/**
 * Creating, redeeming and revoking library shares.
 *
 * Same rules as every other service module (see the header of
 * `lib/services/recipes.ts`): takes a context, never reads headers, never
 * redirects, never calls revalidatePath.
 *
 * The scope itself — what a share actually exposes — lives in
 * `library-share-scope.ts` and is not duplicated here.
 */

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import {
  collections,
  households,
  householdMembers,
  libraryShareCollections,
  libraryShareImports,
  libraryShareTags,
  libraryShares,
  recipes,
} from "@dishes/db/schema";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { HouseholdContext, PrivilegedContext } from "@/lib/session";
import {
  countRecipesInScope,
  loadShareScope,
  loadShareScopeAsOwner,
  type ShareBaseScope,
} from "@/lib/services/library-share-scope";

// --- Errors -----------------------------------------------------------------

export class LibraryShareForbiddenError extends Error {
  constructor(message = "Only admins can manage shared libraries") {
    super(message);
    this.name = "LibraryShareForbiddenError";
  }
}

export class LibraryShareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryShareValidationError";
  }
}

export class LibraryShareNotFoundError extends Error {
  constructor() {
    super("Shared library not found");
    this.name = "LibraryShareNotFoundError";
  }
}

// --- Input / output types ---------------------------------------------------

export type LibraryShareScopeInput = {
  baseScope: ShareBaseScope;
  /** Ignored unless baseScope === "collections". */
  collectionIds: string[];
  /** Ignored unless baseScope === "tags". */
  includeTags: string[];
  /** Applied on top of any base scope. */
  excludeTags: string[];
};

export type CreateLibraryShareInput = LibraryShareScopeInput & {
  label?: string | null;
  expiresInDays?: number;
};

export type OutgoingShare = {
  id: string;
  label: string | null;
  inviteCode: string;
  inviteExpiresAt: Date | null;
  redeemedAt: Date | null;
  granteeHouseholdName: string | null;
  baseScope: ShareBaseScope;
  /** The current selection, so the owner's scope editor opens pre-filled. */
  includeCollectionIds: string[];
  includeTags: string[];
  excludeTags: string[];
  revokedAt: Date | null;
  revokedBy: "owner" | "grantee" | null;
  recipeCount: number;
  copiedCount: number;
};

export type IncomingShare = {
  id: string;
  ownerHouseholdName: string;
  label: string | null;
  redeemedAt: Date | null;
  recipeCount: number;
};

/**
 * Every outcome here is a page the UI wants to render, so this returns a
 * status rather than throwing. `loadShareScope` throws, because there the only
 * answer is no.
 */
export type InvitePreview =
  | {
      status: "ok";
      shareId: string;
      ownerHouseholdName: string;
      recipeCount: number;
      label: string | null;
    }
  | { status: "self" }
  | { status: "already-redeemed"; byOwnHousehold: boolean; shareId: string | null }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "not-found" };

export type RedeemResult =
  | { status: "redeemed"; shareId: string; ownerHouseholdName: string }
  | { status: "already-connected"; shareId: string }
  | { status: "self" }
  | { status: "unavailable" };

// --- Helpers ----------------------------------------------------------------

const DEFAULT_INVITE_DAYS = 7;

function requireAdmin(ctx: PrivilegedContext) {
  if (ctx.role !== "admin") throw new LibraryShareForbiddenError();
}

function newInviteCode(): string {
  return randomBytes(16).toString("base64url");
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replace a share's selector rows. Caller owns the transaction. */
async function writeScopeRows(
  tx: Tx,
  shareId: string,
  ownerHouseholdId: string,
  input: LibraryShareScopeInput
) {
  await tx.delete(libraryShareCollections).where(eq(libraryShareCollections.shareId, shareId));
  await tx.delete(libraryShareTags).where(eq(libraryShareTags.shareId, shareId));

  if (input.baseScope === "collections") {
    const ids = [...new Set(input.collectionIds)];
    if (ids.length === 0) {
      throw new LibraryShareValidationError("Pick at least one collection to share");
    }
    // Only the owner's own collections may be named.
    const owned = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.householdId, ownerHouseholdId), inArray(collections.id, ids)));

    if (owned.length !== ids.length) {
      throw new LibraryShareValidationError("Unknown collection");
    }
    await tx
      .insert(libraryShareCollections)
      .values(ids.map((collectionId) => ({ shareId, collectionId })));
  }

  if (input.baseScope === "tags") {
    const tags = cleanTags(input.includeTags);
    if (tags.length === 0) {
      throw new LibraryShareValidationError("Pick at least one tag to share");
    }
    await tx.insert(libraryShareTags).values(tags.map((tag) => ({ shareId, tag })));
  }
}

// --- Owner side -------------------------------------------------------------

export async function createLibraryShare(
  ctx: PrivilegedContext,
  input: CreateLibraryShareInput
): Promise<{ shareId: string; inviteCode: string }> {
  requireAdmin(ctx);

  const expiresInDays = input.expiresInDays ?? DEFAULT_INVITE_DAYS;
  const inviteExpiresAt = new Date(Date.now() + expiresInDays * 86400000);
  const inviteCode = newInviteCode();

  return db.transaction(async (tx) => {
    const [share] = await tx
      .insert(libraryShares)
      .values({
        ownerHouseholdId: ctx.householdId,
        createdById: ctx.memberId,
        label: input.label?.trim() || null,
        inviteCode,
        inviteExpiresAt,
        baseScope: input.baseScope,
        excludeTags: cleanTags(input.excludeTags),
      })
      .returning({ id: libraryShares.id });

    await writeScopeRows(tx, share!.id, ctx.householdId, input);

    return { shareId: share!.id, inviteCode };
  });
}

export async function updateLibraryShareScope(
  ctx: PrivilegedContext,
  shareId: string,
  input: LibraryShareScopeInput
): Promise<void> {
  requireAdmin(ctx);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(libraryShares)
      .set({
        baseScope: input.baseScope,
        excludeTags: cleanTags(input.excludeTags),
      })
      .where(
        and(eq(libraryShares.id, shareId), eq(libraryShares.ownerHouseholdId, ctx.householdId))
      )
      .returning({ id: libraryShares.id });

    if (!updated) throw new LibraryShareNotFoundError();

    await writeScopeRows(tx, shareId, ctx.householdId, input);
  });
}

/** Only meaningful before redemption — after that the code is inert. */
export async function rotateLibraryInviteCode(
  ctx: PrivilegedContext,
  shareId: string
): Promise<{ inviteCode: string }> {
  requireAdmin(ctx);

  const inviteCode = newInviteCode();
  const [updated] = await db
    .update(libraryShares)
    .set({
      inviteCode,
      inviteExpiresAt: new Date(Date.now() + DEFAULT_INVITE_DAYS * 86400000),
    })
    .where(
      and(
        eq(libraryShares.id, shareId),
        eq(libraryShares.ownerHouseholdId, ctx.householdId),
        isNull(libraryShares.redeemedAt)
      )
    )
    .returning({ id: libraryShares.id });

  if (!updated) throw new LibraryShareNotFoundError();
  return { inviteCode };
}

export async function revokeLibraryShareAsOwner(
  ctx: PrivilegedContext,
  shareId: string
): Promise<void> {
  requireAdmin(ctx);

  const [updated] = await db
    .update(libraryShares)
    .set({ revokedByOwnerAt: new Date() })
    .where(
      and(
        eq(libraryShares.id, shareId),
        eq(libraryShares.ownerHouseholdId, ctx.householdId),
        isNull(libraryShares.revokedByOwnerAt)
      )
    )
    .returning({ id: libraryShares.id });

  if (!updated) throw new LibraryShareNotFoundError();
}

export async function listOutgoingLibraryShares(
  ctx: HouseholdContext
): Promise<OutgoingShare[]> {
  const rows = await db
    .select({
      id: libraryShares.id,
      label: libraryShares.label,
      inviteCode: libraryShares.inviteCode,
      inviteExpiresAt: libraryShares.inviteExpiresAt,
      redeemedAt: libraryShares.redeemedAt,
      baseScope: libraryShares.baseScope,
      excludeTags: libraryShares.excludeTags,
      revokedByOwnerAt: libraryShares.revokedByOwnerAt,
      revokedByGranteeAt: libraryShares.revokedByGranteeAt,
      granteeHouseholdName: households.name,
    })
    .from(libraryShares)
    .leftJoin(households, eq(households.id, libraryShares.granteeHouseholdId))
    .where(eq(libraryShares.ownerHouseholdId, ctx.householdId))
    .orderBy(desc(libraryShares.createdAt));

  return Promise.all(
    rows.map(async (row) => {
      const [scope, [copied]] = await Promise.all([
        loadShareScopeAsOwner(ctx.householdId, row.id),
        db
          .select({ value: count() })
          .from(libraryShareImports)
          .where(eq(libraryShareImports.shareId, row.id)),
      ]);

      return {
        id: row.id,
        label: row.label,
        inviteCode: row.inviteCode,
        inviteExpiresAt: row.inviteExpiresAt,
        redeemedAt: row.redeemedAt,
        granteeHouseholdName: row.granteeHouseholdName,
        baseScope: row.baseScope,
        includeCollectionIds: scope.includeCollectionIds,
        includeTags: scope.includeTags,
        excludeTags: row.excludeTags ?? [],
        revokedAt: row.revokedByOwnerAt ?? row.revokedByGranteeAt ?? null,
        revokedBy: row.revokedByOwnerAt
          ? ("owner" as const)
          : row.revokedByGranteeAt
            ? ("grantee" as const)
            : null,
        recipeCount: await countRecipesInScope(scope),
        copiedCount: Number(copied?.value ?? 0),
      };
    })
  );
}

/** What the grantee copied, newest first — the owner's "what was taken" view. */
export async function listShareImports(ctx: HouseholdContext, shareId: string) {
  const [owned] = await db
    .select({ id: libraryShares.id })
    .from(libraryShares)
    .where(
      and(eq(libraryShares.id, shareId), eq(libraryShares.ownerHouseholdId, ctx.householdId))
    )
    .limit(1);

  if (!owned) throw new LibraryShareNotFoundError();

  return db
    .select({
      id: libraryShareImports.id,
      importedAt: libraryShareImports.importedAt,
      sourceRecipeId: libraryShareImports.sourceRecipeId,
      title: recipes.title,
    })
    .from(libraryShareImports)
    .leftJoin(recipes, eq(recipes.id, libraryShareImports.sourceRecipeId))
    .where(eq(libraryShareImports.shareId, shareId))
    .orderBy(desc(libraryShareImports.importedAt));
}

// --- Grantee side -----------------------------------------------------------

export async function previewLibraryInvite(
  ctx: HouseholdContext,
  code: string
): Promise<InvitePreview> {
  const [share] = await db
    .select({
      id: libraryShares.id,
      ownerHouseholdId: libraryShares.ownerHouseholdId,
      granteeHouseholdId: libraryShares.granteeHouseholdId,
      label: libraryShares.label,
      inviteExpiresAt: libraryShares.inviteExpiresAt,
      redeemedAt: libraryShares.redeemedAt,
      revokedByOwnerAt: libraryShares.revokedByOwnerAt,
      revokedByGranteeAt: libraryShares.revokedByGranteeAt,
      ownerHouseholdName: households.name,
    })
    .from(libraryShares)
    .innerJoin(households, eq(households.id, libraryShares.ownerHouseholdId))
    .where(eq(libraryShares.inviteCode, code))
    .limit(1);

  if (!share) return { status: "not-found" };
  if (share.ownerHouseholdId === ctx.householdId) return { status: "self" };
  if (share.revokedByOwnerAt || share.revokedByGranteeAt) return { status: "revoked" };

  if (share.redeemedAt) {
    return {
      status: "already-redeemed",
      byOwnHousehold: share.granteeHouseholdId === ctx.householdId,
      shareId: share.granteeHouseholdId === ctx.householdId ? share.id : null,
    };
  }

  if (share.inviteExpiresAt && share.inviteExpiresAt < new Date()) {
    return { status: "expired" };
  }

  const scope = await loadShareScopeAsOwner(share.ownerHouseholdId, share.id);

  return {
    status: "ok",
    shareId: share.id,
    ownerHouseholdName: share.ownerHouseholdName,
    label: share.label,
    recipeCount: await countRecipesInScope(scope),
  };
}

/**
 * Claim an invite. Must be driven by an explicit action, never a page load —
 * a GET may not mutate.
 */
export async function redeemLibraryInvite(
  ctx: PrivilegedContext,
  code: string
): Promise<RedeemResult> {
  requireAdmin(ctx);

  const preview = await previewLibraryInvite(ctx, code);
  if (preview.status === "self") return { status: "self" };
  if (preview.status === "already-redeemed" && preview.shareId) {
    return { status: "already-connected", shareId: preview.shareId };
  }
  if (preview.status !== "ok") return { status: "unavailable" };

  // Conditional update rather than read-then-write: two people opening the
  // same link at once must not both win.
  const [claimed] = await db
    .update(libraryShares)
    .set({
      granteeHouseholdId: ctx.householdId,
      redeemedByMemberId: ctx.memberId,
      redeemedAt: new Date(),
    })
    .where(and(eq(libraryShares.inviteCode, code), isNull(libraryShares.redeemedAt)))
    .returning({ id: libraryShares.id });

  if (!claimed) return { status: "unavailable" };

  return {
    status: "redeemed",
    shareId: claimed.id,
    ownerHouseholdName: preview.ownerHouseholdName,
  };
}

export async function revokeLibraryShareAsGrantee(
  ctx: PrivilegedContext,
  shareId: string
): Promise<void> {
  requireAdmin(ctx);

  const [updated] = await db
    .update(libraryShares)
    .set({ revokedByGranteeAt: new Date() })
    .where(
      and(
        eq(libraryShares.id, shareId),
        eq(libraryShares.granteeHouseholdId, ctx.householdId),
        isNull(libraryShares.revokedByGranteeAt)
      )
    )
    .returning({ id: libraryShares.id });

  if (!updated) throw new LibraryShareNotFoundError();
}

export async function listIncomingLibraryShares(
  ctx: HouseholdContext
): Promise<IncomingShare[]> {
  const rows = await db
    .select({
      id: libraryShares.id,
      label: libraryShares.label,
      redeemedAt: libraryShares.redeemedAt,
      ownerHouseholdName: households.name,
    })
    .from(libraryShares)
    .innerJoin(households, eq(households.id, libraryShares.ownerHouseholdId))
    .where(
      and(
        eq(libraryShares.granteeHouseholdId, ctx.householdId),
        isNull(libraryShares.revokedByOwnerAt),
        isNull(libraryShares.revokedByGranteeAt)
      )
    )
    .orderBy(desc(libraryShares.redeemedAt));

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      ownerHouseholdName: row.ownerHouseholdName,
      label: row.label,
      redeemedAt: row.redeemedAt,
      // Counted through the grantee's own live-grant check, so a share that
      // died between the list query and here reports nothing rather than
      // leaking a count.
      recipeCount: await countRecipesInScope(await loadShareScope(ctx.householdId, row.id)),
    }))
  );
}

/** Members list for attribution copy — who redeemed, shown to the owner. */
export async function getShareRedeemer(shareId: string) {
  const [row] = await db
    .select({ displayName: householdMembers.displayName })
    .from(libraryShares)
    .leftJoin(householdMembers, eq(householdMembers.id, libraryShares.redeemedByMemberId))
    .where(eq(libraryShares.id, shareId))
    .limit(1);
  return row?.displayName ?? null;
}
