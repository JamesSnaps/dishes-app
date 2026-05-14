import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, isStorageAvailable } from "@/lib/storage";

const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest) {
  if (!isStorageAvailable()) {
    return NextResponse.json(
      { error: "Image storage is not configured on this server." },
      { status: 503 }
    );
  }

  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, WebP, and GIF images are allowed." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds the 8 MB limit." },
      { status: 400 }
    );
  }

  const ext = file.type.split("/")[1]!.replace("jpeg", "jpg");
  const key = `recipes/${householdId}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const url = await uploadFile(key, buffer, file.type);
  return NextResponse.json({ url });
}
