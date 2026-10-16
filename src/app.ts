import express from "express";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { issuer, resourceUrl, metadataUrl, requiredScope, verifyToken, type TokenCheck } from "./auth.js";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type ServerInstallation } from "./server.js";

export interface AppDependencies {
  verifyToken?: (token: string) => Promise<TokenCheck>;
  serverFactory?: () => ServerInstallation;
}

interface SessionInstallation extends ServerInstallation {
  transport: StreamableHTTPServerTransport;
  owner: string;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const checkToken = dependencies.verifyToken ?? verifyToken;
  const serverFactory = dependencies.serverFactory ?? createServer;
  const sessions = new Map<string, SessionInstallation>();

  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
    );
    res.header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "Pitch-Fork",
      status: "ok",
      mcpEndpoint: "/mcp",
      authEnabled: true,
    });
  });
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => {
    res.set("Cache-Control", "public, max-age=300").json({
      resource: resourceUrl, authorization_servers: [issuer], scopes_supported: [requiredScope], bearer_methods_supported: ["header"],
    });
  });

  app.use("/mcp", async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.header("authorization") ?? "");
    const checked = match ? await checkToken(match[1]) : undefined;
    if (!checked?.ok) {
      const insufficient = checked?.reason === "insufficient_scope";
      res.status(insufficient ? 403 : 401).set("WWW-Authenticate",
        `Bearer resource_metadata="${metadataUrl}", scope="${requiredScope}"` +
        (checked ? `, error="${checked.reason}"` : ""),
      ).json({ error: checked?.reason ?? "missing_bearer_token" });
      return;
    }
    const owner = String(checked.authInfo.extra?.sub);
    const sessionId = req.header("mcp-session-id");
    if (sessionId && sessions.has(sessionId) && sessions.get(sessionId)!.owner !== owner) {
      res.status(403).json({ error: "session_owner_mismatch" });
      return;
    }
    (req as typeof req & { auth: AuthInfo }).auth = checked.authInfo;
    next();
  });

  app.post("/mcp", async (req, res) => {
    try {
      const requestedSessionId = req.header("mcp-session-id");
      let installation = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

      if (!installation && !requestedSessionId && isInitializeRequest(req.body)) {
        const { server } = serverFactory();
        const owner = String((req as typeof req & { auth: AuthInfo }).auth.extra?.sub);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: sessionId => {
            sessions.set(sessionId, { server, transport, owner });
          },
        });
        transport.onclose = () => {
          const sessionId = transport.sessionId;
          if (sessionId) sessions.delete(sessionId);
        };
        installation = { server, transport, owner };
        await server.connect(transport);
      }

      if (!installation) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Invalid or missing MCP session." },
          id: null,
        });
        return;
      }

      const { transport } = installation;
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const installation = sessions.get(req.header("mcp-session-id") ?? "");
    if (!installation) {
      res.status(400).send("Invalid or missing MCP session.");
      return;
    }
    await installation.transport.handleRequest(req, res);
  });
  app.delete("/mcp", async (req, res) => {
    const installation = sessions.get(req.header("mcp-session-id") ?? "");
    if (!installation) {
      res.status(400).send("Invalid or missing MCP session.");
      return;
    }
    await installation.transport.handleRequest(req, res);
  });

  return app;
}
