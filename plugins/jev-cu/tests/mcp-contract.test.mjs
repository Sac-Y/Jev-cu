import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../server/index.mjs";

async function createHarness(t) {
  const handlers = {
    status: async () => ({ platform: "darwin", configured: false, ready: false, code: "not_configured" }),
    configure: async () => ({ status: "cancelled", configured: false, ready: false }),
    candidates: async () => ({ candidates: [], context: "", diagnostics: { clipped: false, totalElements: 0, totalClickable: 0, unknownRoles: [] } }),
    decide: async () => ({ ready: false, code: "not_configured" }),
  };
  const server = createMcpServer({ handlers });
  const client = new Client({ name: "jev-cu-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

test("registers four bounded, documented Jev tools", async (t) => {
  const client = await createHarness(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "jev_status",
    "jev_configure",
    "jev_candidates",
    "jev_decide",
  ]);
  assert.ok(tools.every((tool) => typeof tool.description === "string" && tool.description.length > 20));

  const configure = tools.find((tool) => tool.name === "jev_configure");
  assert.deepEqual(configure.inputSchema.properties, {});

  const candidates = tools.find((tool) => tool.name === "jev_candidates");
  assert.deepEqual(candidates.inputSchema.required.sort(), ["accessibility_text", "goal"]);
  assert.equal(candidates.inputSchema.properties.accessibility_text.maxLength, 50_000);
  assert.equal(candidates.inputSchema.properties.goal.maxLength, 500);
  assert.equal(candidates.inputSchema.properties.max_candidates.maximum, 80);

  const decide = tools.find((tool) => tool.name === "jev_decide");
  assert.deepEqual(decide.inputSchema.required.sort(), ["app", "candidates", "goal"]);
  assert.equal(decide.inputSchema.properties.goal.maxLength, 500);
  assert.equal(decide.inputSchema.properties.app.maxLength, 200);
  assert.equal(decide.inputSchema.properties.candidates.maxItems, 80);
  assert.equal(decide.inputSchema.properties.candidates.items.properties.label.maxLength, 120);
});

test("tool calls return matching text and structured content", async (t) => {
  const client = await createHarness(t);
  const result = await client.callTool({ name: "jev_status", arguments: {} });
  assert.deepEqual(result.structuredContent, {
    platform: "darwin",
    configured: false,
    ready: false,
    code: "not_configured",
  });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test("schema rejects secrets and oversized candidate arrays before handlers", async (t) => {
  const client = await createHarness(t);
  const configure = await client.callTool({
    name: "jev_configure",
    arguments: { api_key: "must-not-be-accepted" },
  });
  assert.equal(configure.isError, true);

  const tooMany = Array.from({ length: 81 }, (_, index) => ({
    id: `i${index}`,
    index,
    role: "button",
    label: `item ${index}`,
  }));
  const decide = await client.callTool({
    name: "jev_decide",
    arguments: { goal: "test", app: "Calendar", candidates: tooMany },
  });
  assert.equal(decide.isError, true);
});
