import { headers } from "next/headers";
import type { AutheliaUser } from "@dishes/shared";
import { OidcError, verifyAccessToken } from "@/lib/oidc";

const DEV_USER: AutheliaUser = {
  username: "dev-user",
  displayName: "Dev User",
  groups: ["admins"],
};

/**
 * Thrown when a request carries no usable identity. Route handlers map this to
 * a 401; server actions let it bubble (the reverse proxy should have blocked
 * the request long before it reached us).
 */
export class AuthError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Identity from Authelia's reverse-proxy headers. This is the browser
 * transport: Authelia authenticates, then injects Remote-User et al.
 */
export async function getAutheliaUser(): Promise<AutheliaUser> {
  const headerList = await headers();

  const userHeader = process.env.AUTHELIA_USER_HEADER ?? "Remote-User";
  const nameHeader = process.env.AUTHELIA_NAME_HEADER ?? "Remote-Name";
  const groupsHeader = process.env.AUTHELIA_GROUPS_HEADER ?? "Remote-Groups";

  const username = headerList.get(userHeader);

  if (!username) {
    if (process.env.NODE_ENV === "development") {
      return DEV_USER;
    }
    throw new AuthError();
  }

  return {
    username,
    displayName: headerList.get(nameHeader) ?? username,
    groups: (headerList.get(groupsHeader) ?? "").split(",").filter(Boolean),
  };
}

/**
 * Identity from an OIDC access token — the native-client transport.
 *
 * Verification lives in `lib/oidc.ts`; it maps the claims
 * (`preferred_username`, `name`, `groups`) onto AutheliaUser so that both
 * transports converge on the same identity and everything downstream
 * (`getOrCreateHousehold`, roles, member attribution) is unchanged.
 *
 * Returns null when there is no bearer token to consider. Throws AuthError
 * when a token is present but invalid — an expired token must not silently
 * fall through to the proxy-header path, which in development would hand it a
 * fully-privileged dev identity.
 *
 * Note: household-scoped integration tokens (`lib/integration-auth.ts`) are
 * deliberately NOT accepted here. They carry no username, so they cannot
 * produce an AutheliaUser; they remain confined to /api/integrations.
 */
async function getBearerUser(): Promise<AutheliaUser | null> {
  const headerList = await headers();
  const token = extractBearerToken(headerList.get("authorization"));

  // No bearer scheme at all — this is a browser request, use the proxy headers.
  if (token === null) return null;

  // Scheme present but no token. Falling through here would hand a malformed
  // request the proxy-header identity (in development, a privileged one).
  if (token === "") throw new AuthError("Empty bearer token");

  try {
    return await verifyAccessToken(token);
  } catch (err) {
    throw new AuthError(
      err instanceof OidcError ? err.message : "Invalid or expired access token"
    );
  }
}

/**
 * The token from an `Authorization: Bearer …` header, or null when the header
 * uses a different scheme or is absent. Returns "" when the scheme is present
 * but the token is missing, so the caller can reject rather than ignore.
 *
 * The scheme is matched case-insensitively: RFC 7235 defines it as a
 * case-insensitive token, and real clients do send `bearer`.
 */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = /^\s*bearer(\s+(?<token>\S*))?\s*$/i.exec(header);
  if (!match) return null;

  return match.groups?.token ?? "";
}

/**
 * The single entry point for resolving who is making a request, regardless of
 * how they connected. Prefer this over getAutheliaUser() in new code.
 */
export async function resolveIdentity(): Promise<AutheliaUser> {
  const bearerUser = await getBearerUser();
  if (bearerUser) return bearerUser;

  return getAutheliaUser();
}
