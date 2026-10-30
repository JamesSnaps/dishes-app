"use client";

/**
 * POSTs JSON to an /api/web route that streams (`Accept: application/x-ndjson`)
 * and hands on each event as its line arrives. A refusal before streaming
 * (bad input, signed out) throws the server's message.
 */
export async function postNdjson<E>(url: string, body: unknown, onEvent: (event: E) => void): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    // application/json too, so a lapsed Authelia session answers 401, not its login page.
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
  });
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
    const reply = await res.json().catch(() => null);
    throw new Error(reply?.error?.message ?? "Something went wrong. Please try again.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}
