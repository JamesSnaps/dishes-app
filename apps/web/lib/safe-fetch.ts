/**
 * Fetching a URL a user typed in, from the server.
 *
 * The recipe web import takes any URL and fetches it from inside the Docker
 * network. Unguarded, that is a way to make the app read things only it can
 * reach: the database admin UI, MinIO, Home Assistant, a cloud metadata
 * endpoint. So every hop — the URL itself and each redirect — must be plain
 * http(s) on the default ports, and its host must resolve only to public
 * addresses.
 *
 * The DNS check runs before the request, so a host that re-resolves to a
 * private address between the check and the connect (DNS rebinding) gets
 * through. Closing that needs a pinned-address agent; for a self-hosted app
 * behind Authelia, where the caller is already a household member, this guard
 * is in proportion.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message = "That address can't be imported from.") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class FetchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchFailedError";
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** An IPv6 address as its eight 16-bit groups ("::ffff:1.2.3.4" included). */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase().replace(/%.*$/, "");
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, dotted.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, undefined];
  const parse = (s: string | undefined) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const front = parse(head);
  const back = parse(tail);
  return [...front, ...Array<number>(8 - front.length - back.length).fill(0), ...back];
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses
    // are the IPv4 address in disguise — and the URL parser writes them in hex
    // ([::ffff:127.0.0.1] becomes [::ffff:7f00:1]), so unwrap by value.
    const g = ipv6Groups(address);
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      const v4 = [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff].join(".");
      return blocked.check(v4, "ipv4");
    }
    return blocked.check(address, "ipv6");
  }
  return true;
}

/** Throws unless the URL is http(s) on a default port with a public host. */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Only http and https links can be imported.");
  }
  if (url.username || url.password) throw new UnsafeUrlError();
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError();

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError();
    return;
  }
  // A dotless name can only be something on the local network.
  if (!host.includes(".") || /\.(local|internal|lan|home|localhost)$/i.test(host)) {
    throw new UnsafeUrlError();
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchFailedError(`Couldn't find ${host} — check the link.`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError();
  }
}

export type SafeFetchResult = {
  /** Where the content actually came from, after redirects. */
  url: string;
  contentType: string;
  body: Buffer;
};

// Plenty of recipe sites sit behind bot protection that turns away anything
// that doesn't look like a browser. This is a user asking for one page, as
// their browser would.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 5;

export async function safeFetch(
  rawUrl: string,
  opts: {
    accept: string;
    maxBytes: number;
    timeoutMs?: number;
    /** The page an image is on: image hosts often refuse a request without it (hotlink protection). */
    referer?: string;
  }
): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a web address.");
  }

  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: opts.accept,
          "Accept-Language": "en-GB,en;q=0.9",
          ...(opts.referer ? { Referer: opts.referer } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new FetchFailedError("The site took too long to respond.");
      }
      throw new FetchFailedError("Couldn't reach that site.");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new FetchFailedError("The site sent a broken redirect.");
      url = new URL(location, url);
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 401 || res.status === 403) {
        throw new FetchFailedError("The site refused the request — it may block automated access.");
      }
      if (res.status === 404) throw new FetchFailedError("That page wasn't found (404).");
      throw new FetchFailedError(`The site returned an error (${res.status}).`);
    }

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > opts.maxBytes) {
      await res.body?.cancel();
      throw new FetchFailedError("That page is too large to import.");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel();
          throw new FetchFailedError("That page is too large to import.");
        }
        chunks.push(value);
      }
    }

    return {
      url: url.toString(),
      contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(),
      body: Buffer.concat(chunks),
    };
  }

  throw new FetchFailedError("The site redirected too many times.");
}
