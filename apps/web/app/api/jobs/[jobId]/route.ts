import { NextRequest, NextResponse } from "next/server";
import { getAutheliaUser } from "@/lib/auth";
import { getRedis } from "@/lib/redis";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    await getAutheliaUser();

    const redis = getRedis();
    if (!redis) {
      // No Redis — optimistically report done so the client refreshes
      return NextResponse.json({ status: "done" });
    }

    const data = await redis.get(`image-gen-job:${jobId}`);
    if (!data) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json(
      { error: "Failed to check job status" },
      { status: 500 }
    );
  }
}
