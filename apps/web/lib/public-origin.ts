/**
 * The origin external clients should use to reach this app, e.g.
 * "https://dishes.example.com". Behind the reverse proxy the Host header is the
 * container's, so prefer the X-Forwarded-* pair the proxy sets.
 */
export function publicOrigin(headers: Headers): string {
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host") || "localhost:3000";
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = forwardedProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}
