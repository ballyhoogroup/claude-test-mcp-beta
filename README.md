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

## Authentication (optional, via WorkOS AuthKit)

By default this server is fully open — no auth. You can put it behind OAuth
2.1 using [WorkOS AuthKit](https://workos.com/docs/authkit/mcp) as the
authorization server, while this server acts as the resource server
(verifying bearer tokens via AuthKit's JWKS endpoint). Auth is **opt-in**: it
only turns on once both env vars below are set, so it won't break an
existing open deployment until you configure it.

### 1. WorkOS dashboard setup

1. Sign up / log in at [dashboard.workos.com](https://dashboard.workos.com) and
   select (or create) an environment.
2. Enable **AuthKit** for that environment if it isn't already.
3. Note your AuthKit domain, shown in the AuthKit settings — it looks like
   `your-subdomain.authkit.app`.
4. Under **Connect → Configuration**, enable **Client ID Metadata Document
   (CIMD)**. Enable **Dynamic Client Registration (DCR)** as well for backward
   compatibility with MCP clients that do not support CIMD yet.
5. Add `https://<your-service-name>.onrender.com/mcp` as a **Resource Indicator**.
   It must exactly match `MCP_RESOURCE_URL`. Setting it as the default also
   supports older clients that omit the OAuth `resource` parameter.

No API key is needed for the server itself — token verification uses
AuthKit's public JWKS, not a secret.

### 2. Set environment variables on Render

In the Render dashboard, open the service → **Environment**, and add:

| Key | Value |
| --- | --- |
| `AUTHKIT_DOMAIN` | `your-subdomain.authkit.app` (from step 1) |
| `MCP_RESOURCE_URL` | `https://<your-service-name>.onrender.com/mcp` (the full MCP endpoint, with no trailing slash) |

Save — Render redeploys automatically. Once both are set, `/mcp` requires a
valid bearer token, and `GET /.well-known/oauth-protected-resource` starts
returning the resource metadata that points MCP clients at AuthKit.

### 3. How the flow works

1. An MCP client (ChatGPT, Claude) calls `POST /mcp` with no token.
2. This server replies `401` with a `WWW-Authenticate: Bearer
   resource_metadata="https://.../.well-known/oauth-protected-resource"`
   header.
3. The client fetches that metadata, finds AuthKit listed as the
   authorization server, and runs the OAuth 2.1 + PKCE flow directly against
   AuthKit (self-registering via Dynamic Client Registration).
4. The client retries `POST /mcp` with `Authorization: Bearer <token>`. This
   server verifies the token's signature, issuer, expiration, and audience
   against AuthKit's JWKS and, if valid, handles the request as normal.

No changes are needed on the ChatGPT/Claude Desktop side beyond what's
already in [Connecting clients](#connecting-clients) below — the OAuth
dance is automatic once the server advertises it.

## Connecting clients

### ChatGPT Connectors

1. In ChatGPT, go to **Settings > Connectors > Create/Add connector** (custom
   MCP server).
2. Enter your Render URL's `/mcp` endpoint, e.g.
   `https://<your-service-name>.onrender.com/mcp`.
3. Choose automatic OAuth discovery; do not enter a separate client id or
   client secret. ChatGPT will discover AuthKit from the server's protected
   resource metadata, then discover or register its OAuth client using CIMD
   or DCR.
4. ChatGPT will discover the `search` and `fetch` tools automatically after
   the user completes the AuthKit sign-in flow.

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

Point any client that supports the Streamable HTTP transport at the `/mcp`
URL. OAuth authentication is required whenever the two AuthKit environment
variables are configured.

## Notes

- The server is stateless: each HTTP request creates a fresh MCP server +
  transport instance (`sessionIdGenerator: undefined`), which keeps it simple
  to run on Render's free tier without sticky sessions.
- Pitch-Fork provides searchable company profiles and structured company information.
