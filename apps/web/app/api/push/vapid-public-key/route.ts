import { NextResponse } from "next/server";

// Read VAPID_PUBLIC_KEY from the live process env on every request — never let
// this be statically evaluated at build time (where the key isn't present).
export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "Push notifications not configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
