import http2 from "node:http2";
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import { eq, inArray } from "drizzle-orm";
import { apnsDevices, type ApnsDevice } from "@dishes/db/schema";
import { db } from "@/lib/db";
import type { PushPayload } from "@/lib/push";

/**
 * Apple Push for the native iOS app, with token (.p8) authentication: one
 * signed JWT, reused for up to 50 minutes (Apple rejects one older than an
 * hour and throttles one refreshed more often than every 20), over a long-lived
 * HTTP/2 connection per environment.
 *
 * Configured by APNS_KEY_ID, APNS_TEAM_ID and either APNS_KEY (the .p8's
 * contents; literal "\n"s are accepted, so it fits on one env line) or
 * APNS_KEY_FILE (a path to it). APNS_TOPIC is the app's bundle id.
 */

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;
type Environment = keyof typeof HOSTS;

const TOKEN_TTL_MS = 50 * 60_000;

function readKey(): string | null {
  const inline = process.env.APNS_KEY?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const path = process.env.APNS_KEY_FILE?.trim();
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`[apns] can't read APNS_KEY_FILE (${path}):`, err);
    return null;
  }
}

export function apnsConfigured(): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    (process.env.APNS_KEY || process.env.APNS_KEY_FILE)
  );
}

function topic(): string {
  return process.env.APNS_TOPIC?.trim() || "uk.collco.dishes";
}

let cachedToken: { value: string; at: number } | null = null;

async function providerToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) return cachedToken.value;
  const pem = readKey();
  if (!pem) throw new Error("APNs key isn't configured (APNS_KEY or APNS_KEY_FILE)");
  const key = await importPKCS8(pem, "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APNS_KEY_ID! })
    .setIssuer(process.env.APNS_TEAM_ID!)
    .setIssuedAt()
    .sign(key);
  cachedToken = { value, at: Date.now() };
  return value;
}

const sessions = new Map<Environment, http2.ClientHttp2Session>();

function session(env: Environment): http2.ClientHttp2Session {
  const existing = sessions.get(env);
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const client = http2.connect(HOSTS[env]);
  // Apple closes idle connections; the next send opens a new one.
  const forget = () => {
    if (sessions.get(env) === client) sessions.delete(env);
  };
  client.on("close", forget);
  client.on("goaway", forget);
  client.on("error", (err) => {
    console.error(`[apns] ${env} connection error:`, err.message);
    forget();
  });
  // Don't keep the process alive just for an idle push connection.
  client.unref();
  sessions.set(env, client);
  return client;
}

interface ApnsResponse {
  status: number;
  reason?: string;
}

function post(env: Environment, token: string, headers: Record<string, string>, body: string): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    const req = session(env).request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      ...headers,
    });
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.setTimeout(15_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on("response", (h) => {
      status = Number(h[":status"]);
    });
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => {
      let reason: string | undefined;
      try {
        reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
      } catch {
        reason = data || undefined;
      }
      resolve({ status, reason });
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** What Apple says when a token will never work again — prune it. */
const GONE_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);

export interface ApnsResult {
  sent: number;
  failed: number;
  stale: number;
}

/**
 * Send a visible notification to each device, or with `silent` a background
 * push that only wakes the app to sync. Never throws; failures are logged with
 * Apple's reason and dead tokens are pruned.
 */
export async function deliverToApnsDevices(
  devices: ApnsDevice[],
  payload: PushPayload | null,
  options: { silent?: boolean } = {}
): Promise<ApnsResult> {
  if (devices.length === 0 || !apnsConfigured()) return { sent: 0, failed: 0, stale: 0 };

  let jwt: string;
  try {
    jwt = await providerToken();
  } catch (err) {
    console.error("[apns] couldn't sign the provider token:", err);
    return { sent: 0, failed: devices.length, stale: 0 };
  }

  const silent = options.silent || !payload;
  const body = JSON.stringify(
    silent
      ? { aps: { "content-available": 1 } }
      : {
          aps: {
            alert: { title: payload!.title, ...(payload!.body ? { body: payload!.body } : {}) },
            sound: "default",
            // Wakes the app to sync as the notification arrives.
            "content-available": 1,
            ...(payload!.tag ? { "thread-id": payload!.tag } : {}),
          },
          ...(payload!.url ? { url: payload!.url } : {}),
        }
  );
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    "apns-topic": topic(),
    "apns-push-type": silent ? "background" : "alert",
    "apns-priority": silent ? "5" : "10",
  };
  // A later notification with the same tag replaces the earlier one (≤64 bytes).
  if (!silent && payload?.tag) headers["apns-collapse-id"] = payload.tag.slice(0, 64);

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];

  await Promise.allSettled(
    devices.map(async (device) => {
      const env: Environment = device.environment === "sandbox" ? "sandbox" : "production";
      try {
        const res = await post(env, device.token, headers, body);
        if (res.status === 200) {
          sent++;
        } else if (res.status === 410 || (res.reason && GONE_REASONS.has(res.reason))) {
          gone.push(device.id);
        } else {
          failed++;
          console.error(
            `[apns] send failed: status=${res.status} reason=${res.reason ?? "?"} env=${env} device=${device.deviceName ?? device.id}`
          );
          // A rejected provider token won't get better by reusing it.
          if (res.status === 403) cachedToken = null;
        }
      } catch (err) {
        failed++;
        console.error(`[apns] send error (${env}):`, err instanceof Error ? err.message : err);
      }
    })
  );

  if (gone.length > 0) {
    console.info(`[apns] pruning ${gone.length} unregistered device(s)`);
    await db.delete(apnsDevices).where(inArray(apnsDevices.id, gone));
  }

  return { sent, failed, stale: gone.length };
}

export async function apnsDevicesFor(householdId: string, users?: string[]): Promise<ApnsDevice[]> {
  const rows = await db.select().from(apnsDevices).where(eq(apnsDevices.householdId, householdId));
  return users ? rows.filter((d) => users.includes(d.autheliaUser)) : rows;
}
