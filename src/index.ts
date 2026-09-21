import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createServer, supportBridgeEnabled } from "./server.js";
import {
  authEnabled,
  authorizationServerMetadataUrl,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  verifyBearerToken,
} from "./auth.js";

const app = express();
app.use(express.json());

// Permissive CORS: MCP clients (ChatGPT, Claude, browser-based tools) call
// this cross-origin, and the OAuth flow needs the WWW-Authenticate header
// readable by the client.
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
    authEnabled,
    supportBridgeEnabled,
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// RFC 9728 Protected Resource Metadata — lets OAuth-aware MCP clients (e.g.
// ChatGPT, Claude) discover that WorkOS AuthKit is the authorization server
// for this resource. Only served once auth is actually configured.
app.get(
  ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
  (_req, res) => {
    if (!authEnabled) {
      res.status(404).json({ error: "oauth_not_configured" });
      return;
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json(protectedResourceMetadata());
  },
);

// Compatibility endpoint for older MCP clients that look for authorization
// server metadata on the resource server instead of following RFC 9728.
// AuthKit remains the source of truth for this document.
app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
  if (!authEnabled) {
    res.status(404).json({ error: "oauth_not_configured" });
    return;
  }

  try {
    const upstream = await fetch(authorizationServerMetadataUrl());
    if (!upstream.ok) {
      throw new Error(`AuthKit metadata request failed with status ${upstream.status}`);
    }

    res.set("Cache-Control", "public, max-age=300");
    res.json(await upstream.json());
  } catch (error) {
    console.error("Error fetching AuthKit authorization server metadata:", error);
    res.status(502).json({ error: "authorization_server_metadata_unavailable" });
  }
});

function sendUnauthorized(res: express.Response, reason: string) {
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
      error: { code: -32001, message: `Unauthorized: ${reason}` },
      id: null,
    });
}

// Authenticate every MCP transport method. Some clients probe the GET route
// before sending an initialize POST; that probe must receive the same OAuth
// challenge or the client cannot discover the authorization server.
app.use("/mcp", async (req, res, next) => {
  const tokenCheck = await verifyBearerToken(req.header("authorization"));
  if (!tokenCheck.ok) {
    sendUnauthorized(res, tokenCheck.reason);
    return;
  }
  if (tokenCheck.authInfo) {
    (req as typeof req & { auth: AuthInfo }).auth = tokenCheck.authInfo;
  }
  next();
});

// Streamable HTTP transport, run statelessly: a fresh MCP server + transport
// is created per request, so there is no session state to manage across
// Render's ephemeral/scaled instances.
app.post("/mcp", async (req, res) => {
  const { server, support } = createServer();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([transport.close(), server.close(), support?.close()]);
  };
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    res.on("close", () => {
      void close();
    });
    await server.connect(transport);
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
    await close();
  }
});

// The stateless Streamable HTTP transport only supports POST; GET/DELETE are
// used by clients for SSE streaming / session teardown, neither of which
// this server needs.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Pitch-Fork MCP server listening on port ${PORT}`);
});
