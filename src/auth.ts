import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

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
  | { ok: true; authInfo: AuthInfo }
  | { ok: false; reason: string };

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanClaim(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function tokenScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter(Boolean);
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === "string");
  }
  return [];
}

/** Verify the WorkOS token before its claims are attached to the MCP request. */
export async function verifyBearerToken(authorizationHeader: string | undefined): Promise<TokenCheck> {
  if (!authEnabled) return { ok: false, reason: "oauth_not_configured" };
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_bearer_token" };
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  try {
    const { payload } = await jwtVerify(token, jwks!, { issuer, audience: resourceUrl });
    const subject = stringClaim(payload.sub);
    if (!subject) return { ok: false, reason: "missing_subject" };

    return {
      ok: true,
      authInfo: {
        token,
        clientId: stringClaim(payload.client_id) ?? stringClaim(payload.azp) ?? "unknown-client",
        scopes: tokenScopes(payload),
        expiresAt: payload.exp,
        resource: new URL(resourceUrl!),
        extra: {
          subject,
          sessionId: stringClaim(payload.sid),
          organizationId: stringClaim(payload.org_id),
          workspaceId: stringClaim(payload.workspace_id),
          name: stringClaim(payload.name),
          email: stringClaim(payload.email),
          emailVerified: booleanClaim(payload.email_verified),
        },
      },
    };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
