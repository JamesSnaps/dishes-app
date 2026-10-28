import { getOidcConfig } from "@/lib/oidc";

/**
 * OAuth discovery for the MCP endpoint (RFC 9728 protected resource
 * metadata), so a claude.ai custom connector can sign in through Authelia:
 * a 401 from `/api/integrations/mcp` points at this metadata, which names
 * Authelia as the authorization server. Only when OIDC is set up
 * (`DISHES_OIDC_ISSUER`); without it the endpoint takes integration tokens only.
 */

export const MCP_PATH = "/api/integrations/mcp";

/** Where the metadata lives: the RFC 9728 path-suffixed form for the MCP endpoint. */
export function mcpResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/**
 * The scopes a connector should ask for: `profile` gives the username a
 * household membership is keyed on and `groups` the roles, as for the iOS
 * app; `offline_access` lets it refresh rather than sign in every hour.
 */
export const MCP_OAUTH_SCOPES = ["openid", "profile", "email", "groups", "offline_access"];

export function mcpResourceMetadata(origin: string) {
  const oidc = getOidcConfig();
  if (!oidc) return null;
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [oidc.issuer],
    scopes_supported: MCP_OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Dishes",
  };
}
