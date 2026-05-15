import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, deleteFile, keyFromUrl, isStorageAvailable } from "@/lib/storage";
import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  if (!isStorageAvailable()) {
    return NextResponse.json(
      { error: "Image storage is not configured on this server." },
      { status: 503 }
    );
  }

  const { memberId } = await params;
  const user = await getAutheliaUser();
  const { householdId, memberId: currentMemberId, role } = await requireHousehold(user);

  const [targetMember] = await db
    .select({ id: householdMembers.id, avatarUrl: householdMembers.avatarUrl })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true)
      )
    )
    .limit(1);

  if (!targetMember) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  if (currentMemberId !== memberId && role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, and WebP images are allowed." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds the 4 MB limit." },
      { status: 400 }
    );
  }

  const ext = file.type.split("/")[1]!.replace("jpeg", "jpg");
  const key = `avatars/${householdId}/${memberId}-${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadFile(key, buffer, file.type);

  // Best-effort cleanup of previous avatar
  if (targetMember.avatarUrl) {
    const oldKey = keyFromUrl(targetMember.avatarUrl);
    if (oldKey) await deleteFile(oldKey).catch(() => {});
  }

  await db
    .update(householdMembers)
    .set({ avatarUrl: url })
    .where(eq(householdMembers.id, memberId));

  revalidatePath("/settings");

  return NextResponse.json({ url });
}
