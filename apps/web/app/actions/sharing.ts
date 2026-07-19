"use server";

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import {
  shareTokens,
  smtpConfigurations,
  recipes,
  recipeIngredients,
  recipeSteps,
  householdMembers,
} from "@dishes/db/schema";
import { eq, and, or, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { encrypt, decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import nodemailer from "nodemailer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildShareUrl(token: string): string {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/share/${token}`;
}

function isTokenActive(token: { revoked: boolean; expiresAt: Date | null }): boolean {
  if (token.revoked) return false;
  if (token.expiresAt && token.expiresAt < new Date()) return false;
  return true;
}

// ─── Share tokens ─────────────────────────────────────────────────────────────

export async function createShareToken(recipeId: string): Promise<string> {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  // Confirm recipe belongs to household
  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  const token = randomBytes(32).toString("hex");

  await db.insert(shareTokens).values({
    householdId,
    recipeId,
    createdById: memberId,
    token,
  });

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/settings/shares");

  return buildShareUrl(token);
}

export async function revokeShareToken(tokenId: string): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .update(shareTokens)
    .set({ revoked: true })
    .where(
      and(eq(shareTokens.id, tokenId), eq(shareTokens.householdId, householdId))
    );

  revalidatePath("/settings/shares");
}

export async function getRecipeShareTokens(recipeId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const tokens = await db
    .select({
      id: shareTokens.id,
      token: shareTokens.token,
      expiresAt: shareTokens.expiresAt,
      revoked: shareTokens.revoked,
      createdAt: shareTokens.createdAt,
      createdBy: householdMembers.displayName,
    })
    .from(shareTokens)
    .leftJoin(householdMembers, eq(shareTokens.createdById, householdMembers.id))
    .where(
      and(
        eq(shareTokens.recipeId, recipeId),
        eq(shareTokens.householdId, householdId)
      )
    )
    .orderBy(shareTokens.createdAt);

  return tokens.map((t) => ({
    ...t,
    active: isTokenActive(t),
    url: buildShareUrl(t.token),
  }));
}

export async function getAllShareTokens() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const tokens = await db
    .select({
      id: shareTokens.id,
      token: shareTokens.token,
      expiresAt: shareTokens.expiresAt,
      revoked: shareTokens.revoked,
      createdAt: shareTokens.createdAt,
      recipeId: shareTokens.recipeId,
      recipeTitle: recipes.title,
      createdBy: householdMembers.displayName,
    })
    .from(shareTokens)
    .innerJoin(recipes, eq(shareTokens.recipeId, recipes.id))
    .leftJoin(householdMembers, eq(shareTokens.createdById, householdMembers.id))
    .where(eq(shareTokens.householdId, householdId))
    .orderBy(shareTokens.createdAt);

  return tokens.map((t) => ({
    ...t,
    active: isTokenActive(t),
    url: buildShareUrl(t.token),
  }));
}

// ─── Public recipe lookup (no auth) ──────────────────────────────────────────

export async function getSharedRecipe(token: string) {
  const [row] = await db
    .select({
      tokenId: shareTokens.id,
      revoked: shareTokens.revoked,
      expiresAt: shareTokens.expiresAt,
      recipeId: shareTokens.recipeId,
    })
    .from(shareTokens)
    .where(eq(shareTokens.token, token))
    .limit(1);

  if (!row || !isTokenActive(row)) return null;

  const [recipe, ingredients, steps] = await Promise.all([
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        servings: recipes.servings,
        servingsUnit: recipes.servingsUnit,
        difficulty: recipes.difficulty,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
        notes: recipes.notes,
        createdAt: recipes.createdAt,
        calories: recipes.calories,
        proteinG: recipes.proteinG,
        carbsG: recipes.carbsG,
        fatG: recipes.fatG,
      })
      .from(recipes)
      .where(eq(recipes.id, row.recipeId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: recipeIngredients.id,
        position: recipeIngredients.position,
        ingredientName: recipeIngredients.ingredientName,
        amount: recipeIngredients.amount,
        unit: recipeIngredients.unit,
        preparation: recipeIngredients.preparation,
        isOptional: recipeIngredients.isOptional,
        groupLabel: recipeIngredients.groupLabel,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, row.recipeId))
      .orderBy(recipeIngredients.position),
    db
      .select({
        id: recipeSteps.id,
        position: recipeSteps.position,
        instruction: recipeSteps.instruction,
        durationMinutes: recipeSteps.durationMinutes,
        timerLabel: recipeSteps.timerLabel,
        groupLabel: recipeSteps.groupLabel,
        ingredientIds: recipeSteps.ingredientIds,
      })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, row.recipeId))
      .orderBy(recipeSteps.position),
  ]);

  if (!recipe) return null;

  return { recipe, ingredients, steps };
}

// ─── SMTP config ──────────────────────────────────────────────────────────────

export async function saveSmtpConfig(formData: FormData): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can configure email settings");

  const host = (formData.get("host") as string)?.trim();
  const port = parseInt((formData.get("port") as string)?.trim() || "587", 10);
  const username = (formData.get("username") as string)?.trim();
  const rawPassword = (formData.get("password") as string)?.trim();
  const fromAddress = (formData.get("fromAddress") as string)?.trim();
  const fromName = (formData.get("fromName") as string)?.trim() || null;

  if (!host || !username || !fromAddress) {
    throw new Error("Host, username, and from address are required");
  }

  const existing = await db
    .select({ id: smtpConfigurations.id, encryptedPassword: smtpConfigurations.encryptedPassword })
    .from(smtpConfigurations)
    .where(eq(smtpConfigurations.householdId, householdId))
    .limit(1);

  let encryptedPassword: string;
  if (rawPassword) {
    encryptedPassword = encrypt(rawPassword);
  } else if (existing[0]) {
    encryptedPassword = existing[0].encryptedPassword;
  } else {
    throw new Error("Password is required");
  }

  if (existing[0]) {
    await db
      .update(smtpConfigurations)
      .set({ host, port, username, encryptedPassword, fromAddress, fromName })
      .where(eq(smtpConfigurations.id, existing[0].id));
  } else {
    await db.insert(smtpConfigurations).values({
      householdId,
      host,
      port,
      username,
      encryptedPassword,
      fromAddress,
      fromName,
    });
  }

  revalidatePath("/settings/email");
}

export async function getSmtpConfig(householdId: string) {
  const [config] = await db
    .select({
      id: smtpConfigurations.id,
      host: smtpConfigurations.host,
      port: smtpConfigurations.port,
      username: smtpConfigurations.username,
      fromAddress: smtpConfigurations.fromAddress,
      fromName: smtpConfigurations.fromName,
      encryptedPassword: smtpConfigurations.encryptedPassword,
    })
    .from(smtpConfigurations)
    .where(eq(smtpConfigurations.householdId, householdId))
    .limit(1);

  if (!config) return null;

  return {
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    hasPassword: true,
  };
}

export async function deleteSmtpConfig(): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can remove email settings");

  await db
    .delete(smtpConfigurations)
    .where(eq(smtpConfigurations.householdId, householdId));

  revalidatePath("/settings/email");
}

// ─── Email sending ────────────────────────────────────────────────────────────

export async function sendRecipeEmail(recipeId: string, toAddress: string): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  if (!toAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddress)) throw new Error("Valid email address required");

  const [smtpRow] = await db
    .select()
    .from(smtpConfigurations)
    .where(eq(smtpConfigurations.householdId, householdId))
    .limit(1);

  if (!smtpRow) throw new Error("Email is not configured. Set up SMTP in Settings → Email.");

  // Get or create a share token for this recipe
  const existing = await db
    .select({ token: shareTokens.token })
    .from(shareTokens)
    .where(
      and(
        eq(shareTokens.recipeId, recipeId),
        eq(shareTokens.householdId, householdId),
        eq(shareTokens.revoked, false),
        or(isNull(shareTokens.expiresAt), gt(shareTokens.expiresAt, new Date()))
      )
    )
    .limit(1);

  let shareUrl: string;
  if (existing[0]) {
    shareUrl = buildShareUrl(existing[0].token);
  } else {
    shareUrl = await createShareToken(recipeId);
  }

  const [recipe] = await db
    .select({ title: recipes.title, description: recipes.description, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  const ingredients = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(recipeIngredients.position);

  const password = decrypt(smtpRow.encryptedPassword);

  const transporter = nodemailer.createTransport({
    host: smtpRow.host,
    port: smtpRow.port,
    secure: smtpRow.port === 465,
    auth: { user: smtpRow.username, pass: password },
  });

  const ingredientList = ingredients
    .map((i) => {
      const amount = i.amount ? `${i.amount}${i.unit ? " " + i.unit : ""}` : "";
      return `• ${amount ? amount + " " : ""}${i.ingredientName}${i.preparation ? ", " + i.preparation : ""}${i.isOptional ? " (optional)" : ""}`;
    })
    .join("\n");

  const htmlIngredients = ingredients
    .map((i) => {
      const amount = i.amount ? `<strong>${escapeHtml(i.amount)}${i.unit ? " " + escapeHtml(i.unit) : ""}</strong> ` : "";
      return `<li>${amount}${escapeHtml(i.ingredientName)}${i.preparation ? ` <em>(${escapeHtml(i.preparation)})</em>` : ""}${i.isOptional ? " <span style='color:#888'>(optional)</span>" : ""}</li>`;
    })
    .join("");

  const fromName = smtpRow.fromName || "Dishes";
  const subject = `Recipe: ${recipe.title}`;

  const eTitle = escapeHtml(recipe.title);
  const eDesc = recipe.description ? escapeHtml(recipe.description) : null;
  const eImgUrl = recipe.imageUrl ? escapeHtml(recipe.imageUrl) : null;
  const eShareUrl = escapeHtml(shareUrl);
  const eFromName = escapeHtml(fromName);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:24px;margin-bottom:8px">${eTitle}</h1>
  ${eDesc ? `<p style="color:#555;margin-bottom:24px">${eDesc}</p>` : ""}
  ${eImgUrl ? `<img src="${eImgUrl}" alt="${eTitle}" style="width:100%;border-radius:8px;margin-bottom:24px">` : ""}
  <h2 style="font-size:18px;margin-bottom:8px">Ingredients</h2>
  <ul style="padding-left:20px;margin-bottom:24px">${htmlIngredients}</ul>
  <a href="${eShareUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">View full recipe →</a>
  <p style="margin-top:32px;font-size:12px;color:#999">Shared from ${eFromName}</p>
</body>
</html>`;

  const text = `${recipe.title}\n\n${recipe.description ?? ""}\n\nIngredients:\n${ingredientList}\n\nView full recipe: ${shareUrl}\n\nShared from ${fromName}`;

  await transporter.sendMail({
    from: `"${fromName}" <${smtpRow.fromAddress}>`,
    to: toAddress,
    subject,
    text,
    html,
  });
}
