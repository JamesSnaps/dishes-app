import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors, apiError } from "@/lib/api/respond";
import { setCookPhoto } from "@/lib/services/cook-history";

/**
 * Dish photo for a cook entry. Accepts a raw image body rather than multipart —
 * a native client has bytes and a content type, and multipart just adds framing
 * for no benefit here. The web app keeps using the server action.
 */
export const POST = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { id } = await ctx.params;

    const contentType = req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const raw = Buffer.from(await req.arrayBuffer());

    if (raw.byteLength === 0) {
      return apiError("invalid_request", "Empty request body", 400);
    }

    const { url } = await setCookPhoto(session, id, raw, contentType);

    return NextResponse.json({ url });
  }
);
