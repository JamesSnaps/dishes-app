"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { env } from "@/lib/env";
import * as shares from "@/lib/services/library-shares";
import { importFromLibraryShare } from "@/lib/services/recipe-import";
import type { BatchImportResult } from "@/lib/services/recipe-import";

/**
 * Web transport for library shares. Domain logic lives in
 * `lib/services/library-shares.ts`; this layer only translates, revalidates,
 * and turns thrown service errors into something a form can render.
 */

function inviteUrl(code: string): string {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/library-invite/${code}`;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

type ScopeFormValues = {
  baseScope: shares.LibraryShareScopeInput["baseScope"];
  collectionIds: string[];
  includeTags: string[];
  excludeTags: string[];
  label?: string;
};

export async function createLibraryShare(
  values: ScopeFormValues
): Promise<{ url?: string; error?: string }> {
  try {
    const session = await requireSession();
    const { inviteCode } = await shares.createLibraryShare(session, values);

    revalidatePath("/settings/library-shares");
    return { url: inviteUrl(inviteCode) };
  } catch (err) {
    return { error: message(err, "Couldn't create that share.") };
  }
}

export async function updateLibraryShareScope(
  shareId: string,
  values: ScopeFormValues
): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    await shares.updateLibraryShareScope(session, shareId, values);

    revalidatePath("/settings/library-shares");
    return {};
  } catch (err) {
    return { error: message(err, "Couldn't update that share.") };
  }
}

export async function rotateLibraryInviteCode(
  shareId: string
): Promise<{ url?: string; error?: string }> {
  try {
    const session = await requireSession();
    const { inviteCode } = await shares.rotateLibraryInviteCode(session, shareId);

    revalidatePath("/settings/library-shares");
    return { url: inviteUrl(inviteCode) };
  } catch (err) {
    return { error: message(err, "Couldn't refresh that invite.") };
  }
}

export async function revokeLibraryShareAsOwner(
  shareId: string
): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    await shares.revokeLibraryShareAsOwner(session, shareId);

    revalidatePath("/settings/library-shares");
    return {};
  } catch (err) {
    return { error: message(err, "Couldn't revoke that share.") };
  }
}

export async function revokeLibraryShareAsGrantee(
  shareId: string
): Promise<{ error?: string }> {
  try {
    const session = await requireSession();
    await shares.revokeLibraryShareAsGrantee(session, shareId);

    revalidatePath("/shared");
    return {};
  } catch (err) {
    return { error: message(err, "Couldn't remove that library.") };
  }
}

/** Redemption is an explicit action, never a page load — a GET must not mutate. */
export async function redeemLibraryInvite(
  code: string
): Promise<{ result?: shares.RedeemResult; error?: string }> {
  try {
    const session = await requireSession();
    const result = await shares.redeemLibraryInvite(session, code);

    if (result.status === "redeemed" || result.status === "already-connected") {
      revalidatePath("/shared");
      revalidatePath("/", "layout");
    }
    return { result };
  } catch (err) {
    return { error: message(err, "Couldn't accept that invitation.") };
  }
}

export async function importRecipesFromLibrary(
  shareId: string,
  recipeIds: string[]
): Promise<{ result?: BatchImportResult; error?: string }> {
  try {
    const session = await requireSession();
    const result = await importFromLibraryShare(session, shareId, recipeIds);

    revalidatePath("/recipes");
    revalidatePath("/collections");
    revalidatePath(`/shared/${shareId}`);
    return { result };
  } catch (err) {
    return { error: message(err, "Couldn't add those recipes.") };
  }
}
