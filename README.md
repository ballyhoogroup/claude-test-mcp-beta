# Pitch-Fork MCP Server

**Pitch-Fork** is a company-information and market-intelligence platform with a
[Model Context Protocol](https://modelcontextprotocol.io) server for company
discovery. It provides company `id`, `name`, `industry`, `valuationUsd`, and
`location` data across **fintech**, **agtech**, **martech**, and **femtech**.

It's built to run as a remote, hosted MCP server (deployed on
[Render](https://render.com)) using the
[Streamable HTTP transport](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http),
so it works with:

- **ChatGPT Connectors** (via the `search` / `fetch` tools)
- **Claude Desktop** (as a remote/custom connector)
- Any other MCP-compatible client that supports Streamable HTTP

## Tools

| Tool | Description |
| --- | --- |
| `search` | Search companies by name, industry, or location. Returns `{id, title, url}` results (ChatGPT connector spec). |
| `fetch` | Resolve a `search` result id into a full record (ChatGPT connector spec). |
| `list_companies` | Structured filtering by `industry`, `location` substring, `minValuationUsd`/`maxValuationUsd`, with a `limit`. |
| `get_company` | Look up one company by its `id` (e.g. `co-001`). |
| `list_industries` | List the four industries with company counts. |

When SupportBridge is configured, its streamlined support tools are installed
alongside these five business tools, and every business handler is instrumented.

## Project layout

```
src/
  data.ts    Company information records
  server.ts  MCP server + tool registrations
  index.ts   Express app exposing the server over Streamable HTTP at /mcp
```

## Running locally

```bash
npm install
npm run dev      # tsx watch, http://localhost:3000/mcp
# or
npm run build && npm start
```

Quick verification with curl:

```bash
curl -s http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Deploying to Render

This repo includes a [`render.yaml`](./render.yaml) blueprint.

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the Render dashboard, choose **New > Blueprint** and point it at this
   repository. Render will read `render.yaml` and provision a free Node web
   service (`npm install && npm run build` to build, `npm start` to run).
3. Once deployed, your MCP endpoint is:

   ```
   https://<your-service-name>.onrender.com/mcp
   ```

   (You can also create the service manually: Node runtime, build command
   `npm install && npm run build`, start command `npm start`, health check
   path `/healthz`.)

## Authentication

This MCP server is intentionally public. The `/mcp` endpoint does not require
OAuth, bearer tokens, or API keys from MCP clients.

## Configure SupportBridge

Add these variables to the same Render service:

| Key | Value |
| --- | --- |
| `SUPPORTBRIDGE_SOURCE` | `beta` |
| `SUPPORTBRIDGE_URL` | `http://supportbridge-staging.onrender.com` |
| `SUPPORTBRIDGE_API_KEY` | The SupportBridge SDK API key (store as a secret) |

SupportBridge activates only when both `SUPPORTBRIDGE_SOURCE` and
`SUPPORTBRIDGE_API_KEY` are present. It installs the default streamlined tool
profile and instruments all five company-directory tools. Public calls are
reported without a fabricated customer identity. Do not register legacy
support tools separately.

## Connecting clients

### ChatGPT Connectors

1. In ChatGPT, go to **Settings > Connectors > Create/Add connector** (custom
   MCP server).
2. Enter your Render URL's `/mcp` endpoint, e.g.
   `https://<your-service-name>.onrender.com/mcp`.
3. Choose **No authentication**. No client id, client secret, or OAuth flow is
   required.
4. ChatGPT will discover the `search` and `fetch` tools automatically.

### Claude Desktop

Claude Desktop connects to remote HTTP MCP servers via **Settings > Connectors
> Add custom connector**, using the same `/mcp` URL. (If your version of
Claude Desktop only supports local/stdio servers, use the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge in your
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pitch-fork": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-service-name>.onrender.com/mcp"]
    }
  }
}
```

### Any other MCP client

Point any client that supports the Streamable HTTP transport at the public
`/mcp` URL. No authentication is required.

## Notes

- The server is stateless: each HTTP request creates a fresh MCP server +
  transport instance (`sessionIdGenerator: undefined`), which keeps it simple
  to run on Render's free tier without sticky sessions.
- Pitch-Fork provides searchable company profiles and structured company information.
