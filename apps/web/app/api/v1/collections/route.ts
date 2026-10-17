import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import * as collectionService from "@/lib/services/collections";

/** GET — every collection with its recipe ids. POST — create one by name. */
export const GET = withApiErrors(async () => {
  const session = await requireSession();
  return NextResponse.json({ collections: await collectionService.listCollections(session) });
});

const createSchema = z.object({
  name: z.string().min(1),
  icon: z.string().max(10).nullable().optional(),
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const input = createSchema.parse(await req.json());
  return NextResponse.json(await collectionService.createCollection(session, input), { status: 201 });
});
