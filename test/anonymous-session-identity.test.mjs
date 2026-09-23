import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const originalFetch = globalThis.fetch;
const supportRequests = [];
const offerState = { identity: undefined, armed: false, delivered: false };

process.env.SUPPORTBRIDGE_SOURCE = "beta-test";
process.env.SUPPORTBRIDGE_URL = "https://supportbridge.test";
process.env.SUPPORTBRIDGE_API_KEY = "test-key";

function manualOffer() {
  const now = new Date();
  return {
    delivery: {
      protocol: "durable-offer-delivery-v1",
      leaseId: "lease-0000000000000001",
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
    optionalAssistance: {
      version: "optional-assistance-v1",
      offerId: "offer-live-session-1",
      vendorName: "Pitch Fork Support",
      reasonCode: "interpret_results",
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      disclosureVersion: "test-v1",
      disclosure: "A support representative can help review these results.",
      acceptanceRequired: true,
      deliveryMode: "ask_for_choice",
      mediumPresentation: "app_card",
      context: {
        eventId: "live-user-event-1",
        toolName: "list_industries",
        outcome: "success",
        at: now.toISOString(),
      },
    },
    triggerId: "offer-live-session-1",
    reason: "Manual offer for this live session",
    blocking: false,
    requiresAcknowledgement: false,
    message: "Help is available.",
    retryOriginalRequestAfterDecision: false,
    motion: "assistance",
  };
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (!url.startsWith("https://supportbridge.test")) {
    return originalFetch(input, init);
  }

  const body = typeof init.body === "string" ? init.body : "";
  supportRequests.push({ url, body });
  if (url.endsWith("/v1/offers/lease")) {
    const lookup = JSON.parse(body);
    if (
      offerState.armed &&
      !offerState.delivered &&
      lookup.sessionId === offerState.identity?.sessionId
    ) {
      offerState.delivered = true;
      return Response.json(manualOffer());
    }
    return new Response(null, { status: 204 });
  }
  if (url.includes("/attachments")) return new Response(null, { status: 204 });
  if (url.endsWith("/v1/events")) return new Response(null, { status: 202 });
  if (url.endsWith("/v1/config")) return Response.json({ policies: [] });
  return new Response(null, { status: 404 });
};

const { createApp } = await import("../dist/app.js");
const { identifyAnonymousSession, opaqueSessionId } = await import("../dist/identity.js");

const app = createApp({ authenticationConfigured: false });
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

test("anonymous identity hashes only the trusted transport session", () => {
  const first = identifyAnonymousSession({ sessionId: "raw-session-a", authInfo: { extra: { email: "ignore@example.com" } } });
  const again = identifyAnonymousSession({ sessionId: "raw-session-a" });
  const second = identifyAnonymousSession({ sessionId: "raw-session-b" });

  assert.deepEqual(first, again);
  assert.notDeepEqual(first, second);
  assert.deepEqual(first, {
    userId: `anonymous:${opaqueSessionId("raw-session-a")}`,
    sessionId: opaqueSessionId("raw-session-a"),
  });
  assert.deepEqual(Object.keys(first).sort(), ["sessionId", "userId"]);
  assert.equal(identifyAnonymousSession({ authInfo: { extra: { sessionId: "model-or-auth-value" } } }), undefined);
});

test("session identity, manual offer attachment, tool discovery, and raw-id redaction", async () => {
  const sessionA = await connect(1);
  const sessionB = await connect(2);
  assert.notEqual(sessionA, sessionB);

  const tools = await mcpRequest(
    { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    sessionA,
  );
  assert.ok(tools.payload.result.tools.some(tool => tool.name === "show_support_offer"));

  await callTool(sessionA, 4);
  await callTool(sessionA, 5);
  await callTool(sessionB, 6);

  const lookups = supportRequests
    .filter(request => request.url.endsWith("/v1/offers/lease"))
    .map(request => JSON.parse(request.body));
  const aLookups = lookups.filter(lookup => lookup.sessionId === opaqueSessionId(sessionA));
  const bLookups = lookups.filter(lookup => lookup.sessionId === opaqueSessionId(sessionB));
  assert.equal(aLookups.length, 2);
  assert.equal(bLookups.length, 1);
  assert.deepEqual(aLookups[0], aLookups[1]);
  assert.notEqual(aLookups[0].sessionId, bLookups[0].sessionId);
  assert.deepEqual(Object.keys(aLookups[0]).sort(), ["sessionId", "toolName", "userId"]);

  offerState.identity = aLookups[0];
  offerState.armed = true;
  const offered = await callTool(sessionA, 7);
  assert.equal(offerState.delivered, true);
  assert.match(offered.text, /supportbridge\\?\/?offer/);
  assert.match(offered.text, /show_support_offer/);

  const visibleText = offered.payload.result.content.map(item => item.text).join("\n");
  assert.match(visibleText, /"supportbridge\/offer"/);
  assert.match(visibleText, /"display_tool":"show_support_offer"/);

  await originalFetch(endpoint, {
    method: "DELETE",
    headers: { "mcp-session-id": sessionA, "mcp-protocol-version": "2025-03-26" },
  });
  await originalFetch(endpoint, {
    method: "DELETE",
    headers: { "mcp-session-id": sessionB, "mcp-protocol-version": "2025-03-26" },
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  const externalPayloads = supportRequests.map(request => request.body).join("\n");
  assert.ok(supportRequests.some(request => request.url.endsWith("/v1/events")));
  assert.doesNotMatch(externalPayloads, new RegExp(sessionA, "g"));
  assert.doesNotMatch(externalPayloads, new RegExp(sessionB, "g"));
  assert.doesNotMatch(offered.text, new RegExp(sessionA, "g"));
  assert.doesNotMatch(offered.text, new RegExp(sessionB, "g"));
});
