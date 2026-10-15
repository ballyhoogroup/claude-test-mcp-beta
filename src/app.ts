import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type ServerInstallation } from "./server.js";

export interface AppDependencies {
  serverFactory?: () => ServerInstallation;
}

interface SessionInstallation extends ServerInstallation {
  transport: StreamableHTTPServerTransport;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const serverFactory = dependencies.serverFactory ?? createServer;
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
      authEnabled: false,
    });
  });
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  app.post("/mcp", async (req, res) => {
    try {
      const requestedSessionId = req.header("mcp-session-id");
      let installation = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

      if (!installation && !requestedSessionId && isInitializeRequest(req.body)) {
        const { server } = serverFactory();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: sessionId => {
            sessions.set(sessionId, { server, transport });
          },
        });
        transport.onclose = () => {
          const sessionId = transport.sessionId;
          if (sessionId) sessions.delete(sessionId);
        };
        installation = { server, transport };
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
