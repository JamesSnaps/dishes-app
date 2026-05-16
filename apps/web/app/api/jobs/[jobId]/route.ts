import { NextRequest, NextResponse } from "next/server";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getRedis } from "@/lib/redis";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const redis = getRedis();
    if (!redis) {
      // No Redis — optimistically report done so the client refreshes
      return NextResponse.json({ status: "done" });
    }

    const data = await redis.get(`image-gen-job:${jobId}`);
    if (!data) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.householdId && parsed.householdId !== householdId) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(
      { error: "Failed to check job status" },
      { status: 500 }
    );
  }
}
