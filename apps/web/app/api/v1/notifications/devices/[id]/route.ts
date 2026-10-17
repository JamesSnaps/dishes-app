import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { removeNotificationDevice } from "@/lib/services/notification-settings";

/** DELETE — stop sending to one of your devices (an id from GET /notifications). */
export const DELETE = withApiErrors(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    await removeNotificationDevice(session, (await params).id);
    return new NextResponse(null, { status: 204 });
  }
);
