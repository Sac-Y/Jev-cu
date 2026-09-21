import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createToolHandlers, HandlerError } from "../server/tool-handlers.mjs";

const chineseFixture = fs.readFileSync(
  new URL("../fixtures/ax/activity-monitor-zh.txt", import.meta.url),
  "utf8",
);

const safeInput = {
  goal: "Switch to the previous month",
  app: "Calendar",
  candidates: [{ id: "i56", index: 56, role: "button", label: "previous month" }],
  context: "September 2026",
};

const safeDecision = {
  action: "click_element",
  targetId: "i56",
  targetIndex: 56,
  targetLabel: "button: previous month",
  confidence: 0.96,
  risk: 0.01,
  done: 0.02,
  usage: { inputTokens: 250 },
  latencyMs: 40,
  costUsd: 0.0000105,
  model: "jev-1.13.0",
};

test("status reports a missing credential without exposing storage details", async () => {
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: { status: async () => ({ configured: false }) },
  });
  assert.deepEqual(await handlers.status(), {
    platform: "darwin",
    configured: false,
    ready: false,
    code: "not_configured",
  });
});

test("non-macOS is rejected before touching credentials", async () => {
  let reads = 0;
  const handlers = createToolHandlers({
    platform: "linux",
    credentials: { status: async () => { reads += 1; } },
  });
  assert.deepEqual(await handlers.status(), {
    platform: "linux",
    configured: false,
    ready: false,
    code: "unsupported_platform",
  });
  assert.equal(reads, 0);
});

test("configure imports an env file path without accepting or returning the secret", async () => {
  const imports = [];
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: {
      importFromEnv: async (sourcePath) => {
        imports.push(sourcePath);
        return { configured: true };
      },
    },
  });
  const result = await handlers.configure({ source_file: "/tmp/existing.env" });
  assert.deepEqual(imports, ["/tmp/existing.env"]);
  assert.deepEqual(result, { status: "saved", configured: true, ready: true });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("configure without a source path gives a non-secret setup instruction", async () => {
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: { path: "/Users/test/Library/Application Support/Jev-cu/credentials.env" },
  });
  assert.deepEqual(await handlers.configure({}), {
    status: "source_file_required",
    configured: false,
    ready: false,
    credential_path: "/Users/test/Library/Application Support/Jev-cu/credentials.env",
  });
});

test("configure rejects relative source paths before reading a file", async () => {
  let imports = 0;
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: { importFromEnv: async () => { imports += 1; } },
  });
  await assert.rejects(
    handlers.configure({ source_file: ".env.local" }),
    (error) => error instanceof HandlerError && error.code === "invalid_input",
  );
  assert.equal(imports, 0);
});

test("candidate handler normalizes Chinese accessibility roles", async () => {
  const handlers = createToolHandlers({ platform: "darwin", credentials: {} });
  const parsed = await handlers.candidates({
    accessibility_text: chineseFixture,
    goal: "打开 CPU 标签页",
    max_candidates: 40,
  });
  assert.ok(parsed.candidates.some((item) => item.role === "radio button"));
  assert.ok(parsed.candidates.every((item) => /^i\d+$/.test(item.id)));
});

test("decide reports not_configured without making a Jev request", async () => {
  let requests = 0;
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: {
      read: async () => {
        const error = new Error("missing");
        error.code = "not_configured";
        throw error;
      },
    },
    requestDecision: async () => { requests += 1; },
  });
  assert.deepEqual(await handlers.decide(safeInput), {
    ready: false,
    code: "not_configured",
  });
  assert.equal(requests, 0);
});

test("decide returns bounded decision, policy, and usage without secret material", async () => {
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: { read: async () => "secret-key" },
    requestDecision: async (_input, { apiKey }) => {
      assert.equal(apiKey, "secret-key");
      return safeDecision;
    },
  });
  const result = await handlers.decide(safeInput);
  assert.equal(result.policy.verdict, "proceed");
  assert.deepEqual(result.usage, {
    model: "jev-1.13.0",
    latency_ms: 40,
    input_tokens: 250,
    estimated_cost_usd: 0.0000105,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-key"), false);
  assert.equal(serialized.includes("Authorization"), false);
});

test("unknown and unsafe selected candidates never proceed", async () => {
  for (const [input, decision, expected] of [
    [safeInput, { ...safeDecision, targetId: "i999", targetIndex: 999 }, "escalate"],
    [
      { ...safeInput, candidates: [{ id: "i1", index: 1, role: "button", label: "立即支付" }] },
      { ...safeDecision, targetId: "i1", targetIndex: 1 },
      "confirm",
    ],
  ]) {
    const handlers = createToolHandlers({
      platform: "darwin",
      credentials: { read: async () => "secret-key" },
      requestDecision: async () => decision,
    });
    assert.equal((await handlers.decide(input)).policy.verdict, expected);
  }
});

test("more than 80 candidates fail before credential access", async () => {
  let reads = 0;
  const handlers = createToolHandlers({
    platform: "darwin",
    credentials: { read: async () => { reads += 1; return "secret-key"; } },
  });
  const candidates = Array.from({ length: 81 }, (_, index) => ({
    id: `i${index}`,
    index,
    role: "button",
    label: `item ${index}`,
  }));
  await assert.rejects(
    handlers.decide({ ...safeInput, candidates }),
    (error) => error instanceof HandlerError && error.code === "invalid_input",
  );
  assert.equal(reads, 0);
});
