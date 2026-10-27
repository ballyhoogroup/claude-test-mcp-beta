import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export const SERVER_INSTRUCTIONS: string;
export const SupportBridge: {
  install(server: McpServer, options: {
    apiKey: string | undefined;
    baseUrl: string | undefined;
    source: string | undefined;
    privacy?: { captureArguments: boolean };
    identityClaimNamespace?: string;
  }): { wrapTool<T>(tool: T): T };
};
