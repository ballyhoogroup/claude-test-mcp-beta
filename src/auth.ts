import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export const requiredScope = "access:mcp";
export const resourceUrl = process.env.MCP_RESOURCE_URL ?? "https://pitch-fork-beta.onrender.com/mcp";
export const issuer = new URL(process.env.AUTH0_ISSUER_BASE_URL ?? "https://dev-6zanky8n50kbs3ri.us.auth0.com/").href;
if (!issuer.startsWith("https://") || !resourceUrl.startsWith("https://")) {
  throw new Error("Auth0 issuer and MCP resource must use HTTPS");
}
export const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", resourceUrl).href;
export type TokenCheck = { ok: true; authInfo: AuthInfo } | { ok: false; reason: "invalid_token" | "insufficient_scope" };
const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));

export function createTokenVerifier(key: JWTVerifyGetKey = jwks) {
  return async (token: string): Promise<TokenCheck> => {
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer, audience: resourceUrl, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"],
      });
      if (typeof payload.sub !== "string" || !payload.sub) return { ok: false, reason: "invalid_token" };
      const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
      if (!scopes.includes(requiredScope)) {
        console.warn("MCP authentication rejected: required scope missing");
        return { ok: false, reason: "insufficient_scope" };
      }
      const email = payload[resourceUrl + "/email"];
      const verified = payload[resourceUrl + "/email_verified"];
      return { ok: true, authInfo: {
        token, clientId: typeof payload.azp === "string" ? payload.azp : typeof payload.client_id === "string" ? payload.client_id : "unknown-client",
        scopes, expiresAt: payload.exp, resource: new URL(resourceUrl),
        extra: { sub: payload.sub, subject: payload.sub,
          ...(typeof email === "string" && email ? { email } : {}),
          email_verified: verified === true,
        },
      }};
    } catch (error) {
      // Only library error identifiers; never log the token or decoded claims.
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code) : "unknown";
      const claim = typeof error === "object" && error !== null && "claim" in error
        ? String(error.claim) : undefined;
      console.warn("MCP token validation rejected", { code, claim });
      return { ok: false, reason: "invalid_token" };
    }
  };
}
export const verifyToken = createTokenVerifier();
