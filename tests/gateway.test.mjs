import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatewayDecide, GATEWAY_MODEL, DEFAULT_GATEWAY_ENDPOINT } from "../scripts/gateway-decide.mjs";
import { decide as directDecide } from "../scripts/jev-decide.mjs";
import { resolveDecisionProvider } from "../scripts/loop.mjs";

const candidates = [
  { index: 10, role: "button", label: "7" },
  { index: 24, role: "button", label: "Equals" },
];

function gatewayAnswers(overrides = {}) {
  return {
    target: { type: "choice", choice: "i10", probabilities: { i10: 0.93, i24: 0.07 } },
    action: { type: "choice", choice: "click_element" },
    done: { type: "boolean", probability: 0.01 },
    risk: { type: "boolean", probability: 0.02 },
    ...overrides,
  };
}

function tempEnvFile(value = "test-only") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-cu-gateway-test-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, `AI_GATEWAY_API_KEY=${value}\n`, "utf8");
  return { dir, envFile };
}

test("Gateway request follows the v4 evaluation contract and normalizes TypeSafe confidence", async () => {
  const { dir, envFile } = tempEnvFile();
  let request;
  try {
    const result = await gatewayDecide({
      goal: "Click 7",
      app: "Calculator",
      candidates,
      context: "display: 0",
      recentActions: ["wait", "observe"],
      constraints: "do not submit",
      envFile,
      providerOptions: { gateway: { only: ["typesafe-ai"] } },
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          json: async () => ({
            answers: gatewayAnswers(),
            providerMetadata: { typesafe: { confidence: { target: 0.87 } } },
            usage: { inputTokens: 12, outputTokens: 0 },
          }),
        };
      },
    });

    assert.equal(request.url, DEFAULT_GATEWAY_ENDPOINT);
    assert.match(request.options.headers.Authorization, /^Bearer \S+$/);
    assert.equal(request.options.headers["ai-model-id"], GATEWAY_MODEL);
    assert.equal(request.options.headers["ai-evaluation-model-specification-version"], "4");
    assert.equal(request.options.headers["ai-gateway-auth-method"], "api-key");
    assert.equal(request.options.headers["ai-gateway-protocol-version"], "0.0.1");

    const body = JSON.parse(request.options.body);
    assert.equal(typeof body.state, "string");
    assert.deepEqual(JSON.parse(body.state), {
      goal: "Click 7",
      app: "Calculator",
      context: "display: 0",
      candidates: [
        { id: "i10", desc: "button: 7" },
        { id: "i24", desc: "button: Equals" },
      ],
      recent_actions: ["wait", "observe"],
      constraints: "do not submit",
    });
    assert.equal(body.questions.done.type, "boolean");
    assert.equal(body.questions.done.criteria, undefined);
    assert.deepEqual(Object.keys(body.questions.risk.criteria).sort(), ["false", "true"]);
    assert.deepEqual(body.providerOptions, { gateway: { only: ["typesafe-ai"] } });
    assert.equal(body.model, undefined);

    assert.equal(result.targetIndex, 10);
    assert.equal(result.action, "click_element");
    assert.equal(result.done, 0.01);
    assert.equal(result.risk, 0.02);
    assert.equal(result.confidence, 0.87);
    assert.equal(result.provider, "vercel-ai-gateway");
    assert.equal(result.model, GATEWAY_MODEL);
    assert.equal(result.usage.inputTokens, 12);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Gateway accepts legacy answer fields and falls back to selected probability", async () => {
  const { dir, envFile } = tempEnvFile();
  try {
    const result = await gatewayDecide({
      goal: "Click 7",
      app: "Calculator",
      candidates,
      envFile,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          answers: {
            target: { choice: "i10", probabilities: { i10: 0.91, i24: 0.09 } },
            action: { choice: "click_element" },
            done: { probability: 0.01 },
            risk: { noul: 0.02 },
          },
        }),
      }),
    });
    assert.equal(result.confidence, 0.91);
    assert.equal(result.risk, 0.02);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Gateway rejects missing credentials before making a request", async () => {
  await assert.rejects(
    () => gatewayDecide({
      goal: "Click 7",
      app: "Calculator",
      candidates,
      apiKey: " ",
      fetchImpl: async () => assert.fail("fetch must not run without a key"),
    }),
    error => {
      assert.match(error.message, /AI_GATEWAY_API_KEY/);
      return true;
    },
  );
});

test("Gateway reports HTTP failures without echoing response details or credentials", async () => {
  const secret = "gateway-secret-must-not-appear";
  await assert.rejects(
    () => gatewayDecide({
      goal: "Click 7",
      app: "Calculator",
      candidates,
      apiKey: secret,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: secret } }),
      }),
    }),
    error => {
      assert.equal(error.status, 429);
      assert.match(error.message, /Jev Gateway HTTP 429/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("Gateway rejects incomplete and out-of-range answers", async () => {
  const cases = [
    { answers: gatewayAnswers({ risk: undefined }) },
    { answers: gatewayAnswers({ done: { type: "boolean", probability: 2 } }) },
  ];
  for (const payload of cases) {
    await assert.rejects(
      () => gatewayDecide({
        goal: "Click 7",
        app: "Calculator",
        candidates,
        apiKey: "test-only",
        fetchImpl: async () => ({ ok: true, json: async () => payload }),
      }),
      /Jev Gateway response/,
    );
  }
});

test("Gateway aborts and reports a bounded timeout", async () => {
  let signal;
  await assert.rejects(
    () => gatewayDecide({
      goal: "Click 7",
      app: "Calculator",
      candidates,
      apiKey: "test-only",
      timeoutMs: 10,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return await new Promise(() => {});
      },
    }),
    error => {
      assert.equal(error.code, "ETIMEDOUT");
      assert.match(error.message, /timed out/);
      return true;
    },
  );
  assert.equal(signal.aborted, true);
});

test("Existing TypeSafe direct path and runTask provider selection remain available", () => {
  assert.equal(resolveDecisionProvider("typesafe"), directDecide);
  assert.equal(resolveDecisionProvider("gateway"), gatewayDecide);
  assert.equal(resolveDecisionProvider("vercel-ai-gateway"), gatewayDecide);
  assert.throws(() => resolveDecisionProvider("unknown"), /未知 Jev decision provider/);
});
