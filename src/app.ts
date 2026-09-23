import express from "express";
import { randomUUID } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  authEnabled,
  authorizationServerMetadataUrl,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  type TokenCheck,
  verifyBearerToken,
} from "./auth.js";
import { createServer, supportBridgeEnabled, type ServerInstallation } from "./server.js";

export interface AppDependencies {
  verifyToken?: (authorizationHeader: string | undefined) => Promise<TokenCheck>;
  serverFactory?: () => ServerInstallation;
  authenticationConfigured?: boolean;
}

interface SessionInstallation extends ServerInstallation {
  transport: StreamableHTTPServerTransport;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const verifyToken = dependencies.verifyToken ?? verifyBearerToken;
  const serverFactory = dependencies.serverFactory ?? createServer;
  const authenticationConfigured = dependencies.authenticationConfigured ?? authEnabled;
  const sessions = new Map<string, SessionInstallation>();

  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
      authEnabled: authenticationConfigured,
      supportBridgeEnabled,
    });
  });
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  app.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    (_req, res) => {
      if (!authenticationConfigured) {
        res.status(404).json({ error: "oauth_not_configured" });
        return;
      }
      res.set("Cache-Control", "public, max-age=300");
      res.json(protectedResourceMetadata());
    },
  );

  app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
    if (!authenticationConfigured) {
      res.status(404).json({ error: "oauth_not_configured" });
      return;
    }
    try {
      const upstream = await fetch(authorizationServerMetadataUrl());
      if (!upstream.ok) throw new Error(`AuthKit metadata request failed: ${upstream.status}`);
      res.set("Cache-Control", "public, max-age=300");
      res.json(await upstream.json());
    } catch (error) {
      console.error("Error fetching AuthKit authorization server metadata:", error);
      res.status(502).json({ error: "authorization_server_metadata_unavailable" });
    }
  });

  app.use("/mcp", async (req, res, next) => {
    if (!authenticationConfigured) {
      next();
      return;
    }
    const tokenCheck = await verifyToken(req.header("authorization"));
    if (!tokenCheck.ok) {
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          [
            'Bearer error="unauthorized"',
            'error_description="Authorization needed"',
            `resource_metadata="${protectedResourceMetadataUrl()}"`,
          ].join(", "),
        )
        .json({
          jsonrpc: "2.0",
          error: { code: -32001, message: `Unauthorized: ${tokenCheck.reason}` },
          id: null,
        });
      return;
    }

    (req as typeof req & { auth: AuthInfo }).auth = tokenCheck.authInfo;
    next();
  });

  app.post("/mcp", async (req, res) => {
    try {
      const requestedSessionId = req.header("mcp-session-id");
      let installation = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

      if (!installation && !requestedSessionId && isInitializeRequest(req.body)) {
        const { server, support } = serverFactory();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: sessionId => {
            sessions.set(sessionId, { server, support, transport });
          },
        });
        transport.onclose = () => {
          const sessionId = transport.sessionId;
          if (sessionId) sessions.delete(sessionId);
          void support?.close();
        };
        installation = { server, support, transport };
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
