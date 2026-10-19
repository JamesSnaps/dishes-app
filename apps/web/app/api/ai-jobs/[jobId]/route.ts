import { NextRequest, NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { readAiJob } from "@/lib/ai-jobs";

// Polled by pages (and the app-wide tray) waiting on an AI job. A route, not a
// server action: Next runs server actions one at a time per tab, so polling
// with one would hold up every other action and navigation on the page.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const user = await resolveIdentity();
    const { householdId } = await requireHousehold(user);

    const job = await readAiJob(jobId, householdId);
    if (!job) return NextResponse.json({ status: "not_found" }, { status: 404 });

    // householdId stays server-side; undefined drops out of the JSON.
    return NextResponse.json({ ...job, householdId: undefined }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Failed to check job status" }, { status: 500 });
  }
}
