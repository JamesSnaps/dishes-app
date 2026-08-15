import { createHash } from "crypto";
import { createRemoteJWKSet, jwtVerify, decodeJwt, type JWTPayload } from "jose";
import type { AutheliaUser } from "@dishes/shared";
import { getRedis } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

/**
 * OIDC access-token verification for native clients.
 *
 * Authelia issues **opaque** access tokens by default (`authelia_at_…`), and
 * JWTs only when the client sets `access_token_signed_response_alg`. Both are
 * supported:
 *
 *   - opaque → exchanged for claims at the userinfo endpoint.
 *   - JWT    → signature, issuer and expiry verified locally against the
 *              provider's JWKS, then identity claims read from the payload if
 *              present, otherwise fetched from userinfo.
 *
 * That last fallback is not hypothetical: Authelia deliberately omits
 * `preferred_username` and `groups` from access tokens, so on Authelia the JWT
 * path always ends at userinfo too. Do NOT "optimise" this away by trusting the
 * JWT payload — a token whose only identity is `sub` would key a household on
 * an opaque UUID and grant no groups.
 *
 * Userinfo results are cached in Redis for a short window so a burst of
 * requests from one device doesn't hammer Authelia.
 *
 * Everything here converges on the same `AutheliaUser` the proxy-header path
 * produces, so nothing downstream knows or cares which transport was used.
 */

const log = createLogger("oidc");

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcError";
  }
}

export type OidcConfig = {
  issuer: string;
  clientId: string | undefined;
  userinfoCacheSeconds: number;
};

/** Null when DISHES_OIDC_ISSUER is unset — the app is then proxy-headers-only. */
export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.DISHES_OIDC_ISSUER?.trim();
  if (!issuer) return null;

  return {
    issuer: issuer.replace(/\/$/, ""),
    clientId: process.env.DISHES_OIDC_CLIENT_ID?.trim() || undefined,
    userinfoCacheSeconds: Number(process.env.DISHES_OIDC_USERINFO_CACHE_SECONDS ?? 60),
  };
}

// --- Discovery --------------------------------------------------------------

type Discovery = { jwksUri: string; userinfoEndpoint: string; issuer: string };

declare global {
  var __oidcDiscovery: Promise<Discovery> | undefined;
  var __oidcJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
}

/**
 * Discovery document, fetched once per process. Cached as the in-flight promise
 * so concurrent first requests share one fetch. Cleared on failure so a
 * provider that was briefly down doesn't poison the process for its lifetime.
 */
function getDiscovery(config: OidcConfig): Promise<Discovery> {
  if (global.__oidcDiscovery) return global.__oidcDiscovery;

  const url = `${config.issuer}/.well-known/openid-configuration`;

  global.__oidcDiscovery = (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      throw new OidcError(
        `OIDC discovery failed: ${res.status} ${res.statusText} from ${url}`
      );
    }

    const doc = (await res.json()) as {
      issuer?: string;
      jwks_uri?: string;
      userinfo_endpoint?: string;
    };

    if (!doc.jwks_uri || !doc.userinfo_endpoint) {
      throw new OidcError(`OIDC discovery at ${url} is missing required endpoints`);
    }

    return {
      issuer: doc.issuer ?? config.issuer,
      jwksUri: doc.jwks_uri,
      userinfoEndpoint: doc.userinfo_endpoint,
    };
  })().catch((err) => {
    global.__oidcDiscovery = undefined;
    throw err;
  });

  return global.__oidcDiscovery;
}

function getJwks(jwksUri: string) {
  return (global.__oidcJwks ??= createRemoteJWKSet(new URL(jwksUri), {
    // Refetch at most this often when an unknown `kid` appears, so key rotation
    // is picked up without letting a bad token trigger unbounded fetches.
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  }));
}

// --- Claim mapping ----------------------------------------------------------

type Claims = JWTPayload & {
  preferred_username?: unknown;
  name?: unknown;
  groups?: unknown;
  email?: unknown;
};

/**
 * Whether a claim set carries the identity Dishes needs.
 *
 * Deliberately requires `groups` to be *present* (even if empty) rather than
 * merely absent: an absent groups claim and a genuinely group-less user are
 * indistinguishable, and treating the former as the latter silently downgrades
 * the member's role.
 */
function hasIdentityClaims(claims: Claims): boolean {
  return (
    typeof claims.preferred_username === "string" &&
    claims.preferred_username.length > 0 &&
    Array.isArray(claims.groups)
  );
}

/**
 * Map OIDC claims onto the same shape the Authelia proxy headers produce.
 *
 * `preferred_username` is required and has no fallback. Household membership is
 * keyed on `household_members.authelia_user`, so falling back to `sub` would
 * bootstrap a brand-new household keyed on an opaque UUID rather than resolving
 * the existing member — a silent, confusing failure. Better to reject with an
 * error that names the missing scope.
 */
function claimsToUser(claims: Claims): AutheliaUser {
  const username =
    typeof claims.preferred_username === "string" && claims.preferred_username
      ? claims.preferred_username
      : null;

  if (!username) {
    throw new OidcError(
      "Identity has no preferred_username claim — the client needs the 'profile' scope"
    );
  }

  const groups = Array.isArray(claims.groups)
    ? claims.groups.filter((g): g is string => typeof g === "string")
    : [];

  return {
    username,
    displayName: typeof claims.name === "string" && claims.name ? claims.name : username,
    groups,
  };
}

// --- JWT path ---------------------------------------------------------------

/** Three base64url segments — good enough to route, verification is the gate. */
function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
}

/**
 * Verify a JWT access token's signature, issuer and expiry locally.
 *
 * Identity claims are NOT assumed to be present. Authelia deliberately omits
 * `preferred_username` and `groups` from access tokens — its maintainers treat
 * access tokens as opaque to clients, with identity belonging to the ID token
 * or userinfo endpoint (RFC 9068 gives no guidance, so they omit them). A JWT
 * access token therefore proves the caller is authenticated, but usually can't
 * say who they are. When the claims are missing we fall through to userinfo.
 *
 * Providers that do include the claims get the fast path for free.
 */
async function verifyJwtAccessToken(
  token: string,
  config: OidcConfig
): Promise<AutheliaUser> {
  const discovery = await getDiscovery(config);

  const { payload } = await jwtVerify(token, getJwks(discovery.jwksUri), {
    issuer: discovery.issuer,
    // Only enforce audience when we know it. Authelia sets `aud` to the client
    // id; a provider that omits it shouldn't fail closed on a valid token.
    ...(config.clientId && hasAudience(token) ? { audience: config.clientId } : {}),
  });

  if (hasIdentityClaims(payload as Claims)) {
    return claimsToUser(payload as Claims);
  }

  return resolveViaUserinfo(token, config);
}

function hasAudience(token: string): boolean {
  try {
    const aud = decodeJwt(token).aud;
    return aud !== undefined && (Array.isArray(aud) ? aud.length > 0 : true);
  } catch {
    return false;
  }
}

// --- Userinfo path ----------------------------------------------------------

function cacheKey(token: string): string {
  // Never key on the raw token — Redis contents shouldn't be usable as credentials.
  return `oidc:userinfo:${createHash("sha256").update(token).digest("hex")}`;
}

/**
 * Exchange an access token for identity claims at the userinfo endpoint. Used
 * for opaque tokens (Authelia's default) and for JWT tokens that don't carry
 * identity claims — which, on Authelia, is all of them.
 */
async function resolveViaUserinfo(
  token: string,
  config: OidcConfig
): Promise<AutheliaUser> {
  const redis = getRedis();
  const key = cacheKey(token);

  if (redis && config.userinfoCacheSeconds > 0) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as AutheliaUser;
    } catch {
      // Cache unavailable — fall through to the live call.
    }
  }

  const discovery = await getDiscovery(config);

  const res = await fetch(discovery.userinfoEndpoint, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new OidcError("Access token rejected by the identity provider");
  }
  if (!res.ok) {
    throw new OidcError(`Userinfo request failed: ${res.status} ${res.statusText}`);
  }

  const user = claimsToUser((await res.json()) as Claims);

  if (redis && config.userinfoCacheSeconds > 0) {
    try {
      await redis.set(key, JSON.stringify(user), "EX", config.userinfoCacheSeconds);
    } catch {
      // Caching is an optimisation; a failure here must not fail the request.
    }
  }

  return user;
}

// --- Entry point ------------------------------------------------------------

/**
 * Resolve an OIDC access token to a user. Throws OidcError when the token is
 * invalid, expired, or the provider is unreachable — never falls back to an
 * unauthenticated identity.
 */
export async function verifyAccessToken(token: string): Promise<AutheliaUser> {
  const config = getOidcConfig();
  if (!config) {
    throw new OidcError("Bearer token authentication is not enabled");
  }

  try {
    return looksLikeJwt(token)
      ? await verifyJwtAccessToken(token, config)
      : await resolveViaUserinfo(token, config);
  } catch (err) {
    if (err instanceof OidcError) throw err;
    log.warn(
      "Access token verification failed:",
      err instanceof Error ? err.message : String(err)
    );
    throw new OidcError("Invalid or expired access token");
  }
}

/** Drop cached claims for a token — used when a device is signed out. */
export async function forgetCachedToken(token: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(cacheKey(token));
  } catch {
    // Best effort.
  }
}
