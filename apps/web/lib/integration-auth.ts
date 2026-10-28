import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { householdMembers, integrationTokens } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

export type IntegrationContext = {
  householdId: string;
  tokenId: string;
  scopes: string[];
  /** The member the token acts as (still active in the household), or null. */
  memberId: string | null;
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function resolveToken(raw: string): Promise<IntegrationContext | null> {
  const hash = hashToken(raw);

  const [token] = await db
    .select({
      id: integrationTokens.id,
      householdId: integrationTokens.householdId,
      scopes: integrationTokens.scopes,
      expiresAt: integrationTokens.expiresAt,
      memberId: householdMembers.id,
    })
    .from(integrationTokens)
    // Only a member still active in the token's household counts.
    .leftJoin(
      householdMembers,
      and(
        eq(householdMembers.id, integrationTokens.memberId),
        eq(householdMembers.householdId, integrationTokens.householdId),
        eq(householdMembers.isActive, true)
      )
    )
    .where(eq(integrationTokens.tokenHash, hash))
    .limit(1);

  if (!token) return null;
  if (token.expiresAt && token.expiresAt < new Date()) return null;

  // Fire-and-forget last-used update
  db.update(integrationTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(integrationTokens.id, token.id))
    .catch(() => {});

  return { householdId: token.householdId, tokenId: token.id, scopes: token.scopes, memberId: token.memberId };
}

type RouteHandler = (
  req: NextRequest,
  ctx: IntegrationContext
) => Promise<NextResponse>;

/** `requiredScope: null` lets any valid token through, whatever its scopes. */
export function withIntegrationAuth(requiredScope: string | null, handler: RouteHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const rawToken = authHeader.slice(7);
    const ctx = await resolveToken(rawToken);

    if (!ctx) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    if (requiredScope && !ctx.scopes.includes(requiredScope)) {
      return NextResponse.json(
        { error: `Token missing required scope: ${requiredScope}` },
        { status: 403 }
      );
    }

    const rl = await checkRateLimit(ctx.tokenId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter) },
        }
      );
    }

    return handler(req, ctx);
  };
}

export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  return { raw, hash };
}
