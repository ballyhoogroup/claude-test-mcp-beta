import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupportIdentity } from "@supportbridge/sdk";

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolve a SupportBridge identity only when a trusted upstream has supplied
 * verified MCP auth context. This server does not authenticate requests, so
 * ordinary public calls remain anonymous instead of receiving a fabricated
 * identity.
 */
export function identifyAuthenticatedUser(context?: unknown): SupportIdentity | undefined {
  const authInfo = (context as { authInfo?: AuthInfo } | undefined)?.authInfo;
  const extra = authInfo?.extra;
  const userId = stringClaim(extra?.subject);
  if (!userId) {
    return undefined;
  }

  return {
    userId,
    accountId: stringClaim(extra?.accountId),
    workspaceId: stringClaim(extra?.workspaceId),
    organizationId: stringClaim(extra?.organizationId),
    sessionId: stringClaim(extra?.sessionId),
  };
}
