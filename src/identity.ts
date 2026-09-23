import { createHash } from "node:crypto";
import type { SupportIdentity } from "@supportbridge/sdk";

type McpRequestContext = { sessionId?: unknown };

/**
 * Hash the server-generated MCP transport session before it leaves this service.
 * The namespace prefix prevents this digest from being reused as a generic hash
 * of the transport id elsewhere.
 */
export function opaqueSessionId(rawSessionId: string): string {
  return createHash("sha256")
    .update("pitch-fork/supportbridge-session/v1\0", "utf8")
    .update(rawSessionId, "utf8")
    .digest("hex");
}

/** Resolve the minimal anonymous identity from trusted MCP transport context. */
export function identifyAnonymousSession(context?: unknown): SupportIdentity | undefined {
  const rawSessionId = (context as McpRequestContext | undefined)?.sessionId;
  if (typeof rawSessionId !== "string" || rawSessionId.length === 0) {
    return undefined;
  }

  const sessionId = opaqueSessionId(rawSessionId);
  return { userId: `anonymous:${sessionId}`, sessionId };
}
