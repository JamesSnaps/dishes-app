import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { mutationSchema, pullQuerySchema, pushBodySchema } from "@/lib/api/schemas/sync";
import {
  maybePruneSyncLog,
  pull,
  push,
  type SyncMutation,
  type SyncMutationResult,
} from "@/lib/services/sync";

/**
 * Delta sync.
 *
 *   GET  — changes since a cursor, or a full snapshot when none is given.
 *   POST — a batch of client mutations, each with a client-generated opId so
 *          replays are safe.
 */

export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { cursor, limit } = pullQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const result = await pull(session, { cursor, limit });

  // After the response is assembled, never before: retention must not add
  // latency to a sync, and must not be able to fail one.
  maybePruneSyncLog();

  return NextResponse.json(result);
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { mutations } = pushBodySchema.parse(await req.json());

  // A mutation that doesn't validate fails on its own, like one the service
  // rejects, so the client drops it and the rest of its queue still goes.
  const checked = mutations.map((m) => mutationSchema.safeParse(m));
  const valid = checked.flatMap((c) => (c.success ? [c.data as SyncMutation] : []));
  const applied = await push(session, valid);
  const byOpId = new Map(applied.results.map((r) => [r.opId, r]));

  const results: SyncMutationResult[] = checked.flatMap((c, i) => {
    if (c.success) return [byOpId.get(c.data.opId)!];
    const raw = mutations[i] as { opId?: unknown; type?: unknown } | null;
    // Without an opId the client can't match the failure to its queue entry.
    if (typeof raw?.opId !== "string") return [];
    const issue = c.error.issues[0];
    const where = issue?.path.join(".");
    return [{
      opId: raw.opId,
      status: "failed" as const,
      error: `Invalid ${typeof raw.type === "string" ? raw.type : "mutation"}${where ? ` (${where})` : ""}: ${issue?.message ?? "invalid"}`,
    }];
  });

  return NextResponse.json({ results, cursor: applied.cursor });
});
