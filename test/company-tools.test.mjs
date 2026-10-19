import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const originalFetch = globalThis.fetch;
const activity = [];
process.env.SUPPORTBRIDGE_API_KEY = "test-key";
process.env.SUPPORTBRIDGE_URL = "https://within.test";
process.env.SUPPORTBRIDGE_SOURCE = "beta-pitch-fork-mcp";
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("https://within.test/")) {
    if (String(input).endsWith("/v1/activity")) activity.push(JSON.parse(init.body));
    return Response.json({});
  }
  return originalFetch(input, init);
};

const { createApp } = await import("../dist/app.js");

const app = createApp({ verifyToken: async token => ({ ok: true, authInfo: {
  token, clientId: "test-client", scopes: ["access:mcp"], extra: { sub: "auth0|test" },
}}) });
let server;
let endpoint;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  endpoint = `http://127.0.0.1:${address.port}/mcp`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

async function mcpRequest(body, sessionId) {
  const response = await originalFetch(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${response.status}: ${text}`);
  const dataLine = text.split("\n").find(line => line.startsWith("data: "));
  return {
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
    payload: dataLine ? JSON.parse(dataLine.slice(6)) : text ? JSON.parse(text) : undefined,
    text,
  };
}

async function connect(id) {
  const initialized = await mcpRequest({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "anonymous-session-test", version: "1.0.0" },
    },
  });
  assert.ok(initialized.sessionId);
  await mcpRequest(
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    initialized.sessionId,
  );
  return initialized.sessionId;
}

async function callTool(sessionId, id) {
  return mcpRequest(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "list_industries", arguments: {} },
    },
    sessionId,
  );
}

test("business tools work with the installed SDK", async () => {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const response = await originalFetch(new URL(path, endpoint));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).scopes_supported, ["access:mcp"]);
    assert.equal(response.headers.get("www-authenticate"), null);
  }
  const status = await originalFetch(new URL("/", endpoint));
  assert.equal((await status.json()).authEnabled, true);
  const session = await connect(1);
  try {
    const tools = await mcpRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, session,
    );
    const names = tools.payload.result.tools.map(tool=>tool.name);
    for (const name of ["fetch", "get_company", "list_companies", "list_industries", "search", "get_vendor_answer", "request_assistance"]) assert.ok(names.includes(name),name);
    const result = await callTool(session, 3);
    assert.equal(result.payload.result.isError, undefined);
    const industries = JSON.parse(result.payload.result.content[0].text);
    assert.equal(industries.length, 4);
    assert.ok(industries.every(industry => industry.count > 0));
    for (const [name,args] of [["search",{query:"fintech"}],["fetch",{id:"co-001"}],["get_company",{id:"co-001"}],["list_companies",{limit:1}]]) {
      const called = await mcpRequest({jsonrpc:"2.0",id:name,method:"tools/call",params:{name,arguments:args}},session);
      assert.equal(called.payload.result.isError, undefined);
    }
    assert.equal(activity.length, 5);
    assert.ok(activity.every(row=>row.customerUserId === "auth0|test" && row.source === "beta-pitch-fork-mcp"));
  } finally {
    const closed = await originalFetch(endpoint, {
      method: "DELETE",
      headers: { authorization: "Bearer test-token", "mcp-session-id": session, "mcp-protocol-version": "2025-03-26" },
    });
    assert.equal(closed.status, 200);
  }
});
