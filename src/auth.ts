import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * OAuth 2.1 resource-server support for this MCP server, using WorkOS AuthKit
 * as the authorization server. See https://workos.com/docs/authkit/mcp
 *
 * Auth is opt-in: it only activates once both AUTHKIT_DOMAIN and
 * MCP_RESOURCE_URL are set (e.g. as Render env vars). With neither set, the
 * server behaves exactly as before (fully open) so existing deployments and
 * local dev aren't broken by this change.
 */

function normalizeIssuer(domain: string): string {
  const withScheme = domain.startsWith("http") ? domain : `https://${domain}`;
  return withScheme.replace(/\/$/, "");
}

const rawAuthkitDomain = process.env.AUTHKIT_DOMAIN;
const resourceUrl = process.env.MCP_RESOURCE_URL?.replace(/\/$/, "");
const resourceOrigin = resourceUrl ? new URL(resourceUrl).origin : undefined;
const issuer = rawAuthkitDomain ? normalizeIssuer(rawAuthkitDomain) : undefined;

export const authEnabled = Boolean(issuer && resourceUrl);

const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) : undefined;

if (process.env.AUTHKIT_DOMAIN && !process.env.MCP_RESOURCE_URL) {
  console.warn(
    "AUTHKIT_DOMAIN is set but MCP_RESOURCE_URL is not — OAuth stays disabled until both are set.",
  );
}

export function protectedResourceMetadataUrl(): string {
  return `${resourceOrigin}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata() {
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadataUrl(): string {
  return `${issuer}/.well-known/oauth-authorization-server`;
}

export type TokenCheck =
  | { ok: true; authInfo?: AuthInfo }
  | { ok: false; reason: string };

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload.scope === "string") {
    return payload.scope.split(" ").filter(Boolean);
  }
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === "string");
  }
  return [];
}

export async function verifyBearerToken(authorizationHeader: string | undefined): Promise<TokenCheck> {
  if (!authEnabled) {
    return { ok: true };
  }
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_bearer_token" };
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  try {
    // WorkOS issues the configured Resource Indicator as the access token's
    // `aud` claim. Checking it prevents a token minted for another service in
    // the same WorkOS environment from being replayed against this MCP.
    const { payload } = await jwtVerify(token, jwks!, { issuer, audience: resourceUrl });
    const subject = stringClaim(payload.sub);
    const clientId = stringClaim(payload.client_id) ?? stringClaim(payload.azp) ?? "unknown-client";

    return {
      ok: true,
      authInfo: {
        token,
        clientId,
        scopes: tokenScopes(payload),
        expiresAt: payload.exp,
        resource: new URL(resourceUrl!),
        extra: {
          subject,
          sessionId: stringClaim(payload.sid),
          organizationId: stringClaim(payload.org_id),
          workspaceId: stringClaim(payload.workspace_id),
          accountId: stringClaim(payload.account_id),
        },
      },
    };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
