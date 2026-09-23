import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, supportBridgeEnabled } from "./server.js";

const app = express();
app.use(express.json());

// Permissive CORS: MCP clients (ChatGPT, Claude, browser-based tools) call
// this public endpoint cross-origin.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  );
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
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
    supportBridgeEnabled,
  });
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
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
    try {
      await transport.close();
      await server.close();
    } finally {
      await support?.close();
    }
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
