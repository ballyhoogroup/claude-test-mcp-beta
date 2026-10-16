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

## Authentication

The MCP requires Auth0 RS256 access tokens issued by
`https://dev-6zanky8n50kbs3ri.us.auth0.com/`, with audience
`https://pitch-fork-beta.onrender.com/mcp` and scope `access:mcp`.
Set `AUTH0_ISSUER_BASE_URL` and `MCP_RESOURCE_URL` to override these deployment defaults.
Missing or invalid tokens receive HTTP 401; missing scope receives HTTP 403.
Sessions are bound to the authenticated subject.

OAuth resource metadata is published at
`/.well-known/oauth-protected-resource/mcp`. Auth0 handles login, client registration,
and token issuance. Clients must be authorized for this API in Auth0; creating a
scope alone does not grant it.

The Post Login Action supplies namespaced claims
`https://pitch-fork-beta.onrender.com/mcp/email` and
`https://pitch-fork-beta.onrender.com/mcp/email_verified`. The server maps these
from the validated token to `authInfo.extra.email` and `email_verified`, preserving
verification only when the claim is boolean true. The Auth0 subject is retained
as `extra.sub` and `extra.subject`. Within reads the authenticated tool context directly; no custom identity resolver is supplied.
New tools use the same server-wide `access:mcp` requirement.

## Connecting clients

### ChatGPT Connectors

1. In ChatGPT, go to **Settings > Connectors > Create/Add connector** (custom
   MCP server).
2. Enter your Render URL's `/mcp` endpoint, e.g.
   `https://<your-service-name>.onrender.com/mcp`.
3. Choose **OAuth** and authorize the client for this API in Auth0.
4. ChatGPT will discover `search` and `fetch` automatically.

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

Point any client that supports the Streamable HTTP transport at the `/mcp` URL.
Complete the Auth0 authorization flow and request the `access:mcp` scope.

## Notes

- The server keeps one MCP server + transport instance per connection and
  removes it when the client sends the MCP session teardown request.
- Pitch-Fork provides searchable company profiles and structured company information.

## Within integration

The three SDK modules are vendored without modifications from
`C:/Users/pltow/supportbridge-sdk-fork/product/src` into
`src/within/sdk/index.mjs`, `src/within/activity.mjs`, and `src/within/intents.mjs`.
The TypeScript build copies the JavaScript modules into the same layout under `dist`.

Set `SUPPORTBRIDGE_URL=https://app.getwith.in` and keep
`SUPPORTBRIDGE_API_KEY` as a secret in Render. Do not use the MCP server's own URL
or a loopback URL for this hosted Within service. The SDK requires an API key.
All five company tools use `support.wrapTool`; the SDK registers its own support
tools. Auth0 token verification and the authenticated extra context are unchanged.

### Current supplied SDK limitations

The integration passes `privacy: { captureArguments: false }`, but this supplied
SDK does not implement that option: activity reports still include argument-derived
tokens, summaries, and previews. Do not treat the option as effective until the
upstream SDK implements it. The vendored files are deliberately unchanged.

This SDK also prefers a verified email as its customer user ID, falling back to
`extra.authInfo.extra.sub` when no verified email is present. A subject-only call
was verified to produce an Auth0 subject, not anonymous. Email claims and their
verification status remain intact. Live console verification requires a real sign-in
and configured Within API key.
