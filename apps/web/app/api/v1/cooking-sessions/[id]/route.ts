import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { apiError, withApiErrors } from "@/lib/api/respond";
import {
  cookingSessionSchema,
  endCookingSession,
  publishCookingSession,
} from "@/lib/cooking-sessions";

const idSchema = z.string().uuid();

/**
 * PUT — the device cooking publishes its cook (the whole state each time, with
 * a higher `version`). 409 when a newer version is already stored; 410 when the
 * session has ended or is too old, and the device should stop publishing it.
 */
export const PUT = withApiErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const id = idSchema.parse((await params).id);
    const input = cookingSessionSchema.parse(await req.json());
    const result = await publishCookingSession(session, id, input);
    if (result === "stale") return apiError("conflict", "A newer version of this cook is already stored", 409);
    if (result === "ended") return apiError("gone", "This cook has ended", 410);
    return NextResponse.json({ ok: true });
  }
);

/** DELETE — the cook is over. It can't be published again. */
export const DELETE = withApiErrors(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const id = idSchema.parse((await params).id);
    await endCookingSession(session, id);
    return new NextResponse(null, { status: 204 });
  }
);
