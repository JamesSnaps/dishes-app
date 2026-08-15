import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { pullQuerySchema, pushBodySchema } from "@/lib/api/schemas/sync";
import {
  maybePruneSyncLog,
  pull,
  push,
  type SyncMutation,
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

  return NextResponse.json(await push(session, mutations as SyncMutation[]));
});
