import { NextResponse, type NextRequest } from "next/server";

/** Whether the caller asked for the answer as it's worked out (the iOS app does). */
export function wantsNdjson(req: NextRequest): boolean {
  return (req.headers.get("accept") ?? "").includes("application/x-ndjson");
}

/**
 * One JSON event per line, sent as `run` emits them. `run` must not throw:
 * report a failure as an event of its own so the client reads it in place.
 *
 * If the caller goes away (the app backgrounded, the page left) the work
 * carries on to the end — a recipe half-written is still saved — and the
 * events after that point are dropped rather than failing it.
 */
export function ndjsonResponse<E>(run: (emit: (event: E) => void) => Promise<void>): NextResponse {
  const encoder = new TextEncoder();
  let gone = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await run((e) => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          gone = true;
        }
      });
      if (!gone) controller.close();
    },
    cancel() {
      gone = true;
    },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Through Traefik and Next untouched, a line at a time.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
