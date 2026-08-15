import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { uploadRecipeImage } from "@/lib/services/upload";

/**
 * Raw-body image upload. A native client has bytes and a content type; multipart
 * would only add framing. Send the image as the request body with a matching
 * Content-Type.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const contentType = req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const raw = Buffer.from(await req.arrayBuffer());

  const result = await uploadRecipeImage(session, raw, contentType);

  return NextResponse.json(result, { status: 201 });
});
