import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import {
  uploadRecipeImage,
  UploadUnavailableError,
  UploadValidationError,
} from "@/lib/services/upload";

/**
 * Multipart upload used by the web app's file inputs. Response shape is the
 * browser's contract — keep it stable. Native clients use /api/v1/upload.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  try {
    const result = await uploadRecipeImage(
      session,
      Buffer.from(await file.arrayBuffer()),
      file.type
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UploadUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof UploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
