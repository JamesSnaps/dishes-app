import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { listCookingSessions, type CookingSession } from "@/lib/cooking-sessions";

/**
 * A cook not heard from for this long, with no timer still to run, has been
 * left open somewhere (a closed laptop lid) rather than being cooked. Devices
 * republish every 5 minutes while a cook is on screen, so this is three missed
 * heartbeats; the session itself lingers for 2 hours (lib/cooking-sessions.ts).
 */
const IDLE_MS = 15 * 60_000;

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());

/** Still being cooked: heard from recently, or a timer is yet to go off. */
function isActive(s: CookingSession, now: number): boolean {
  if (now - s.updatedAt < IDLE_MS) return true;
  return s.timers.some((t) => t.state === "running" && t.endsAt != null && t.endsAt > now);
}

// Who's cooking right now: the household's members, and each cook in progress
// with its dish, step and timers. Read-only — cooks are only ever changed by
// the device cooking them.
export const GET = withIntegrationAuth("read:cooking", async (_req: NextRequest, ctx) => {
  const now = Date.now();
  const [members, all] = await Promise.all([
    db
      .select({ id: householdMembers.id, name: householdMembers.displayName })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.isActive, true)))
      .orderBy(asc(householdMembers.displayName)),
    listCookingSessions(ctx.householdId),
  ]);
  const sessions = all.filter((s) => isActive(s, now));
  const cooking = new Set(sessions.map((s) => s.memberId));
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  return NextResponse.json({
    cooking: sessions.length > 0,
    members: members.map((m) => ({ ...m, cooking: cooking.has(m.id) })),
    sessions: sessions.map((s) => ({
      id: s.id,
      memberId: s.memberId,
      memberName: nameOf.get(s.memberId) ?? s.memberName,
      title: s.title,
      dish: s.dish,
      step: s.step,
      totalSteps: s.totalSteps,
      instruction: s.instruction,
      device: s.device,
      startedAt: iso(s.startedAt),
      updatedAt: iso(s.updatedAt),
      timers: s.timers.map((t) => ({
        id: t.id,
        label: t.label,
        dish: t.dish ?? null,
        state: t.state,
        endsAt: t.state === "running" ? iso(t.endsAt) : null,
        remainingSeconds: Math.round(
          (t.state === "running" && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.remainingMs) / 1000
        ),
        durationSeconds: t.durationMs == null ? null : Math.round(t.durationMs / 1000),
      })),
    })),
  });
});
