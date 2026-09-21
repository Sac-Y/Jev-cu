import test from "node:test";
import assert from "node:assert/strict";

import { JevError, requestDecision } from "../server/jev-client.mjs";

const validInput = {
  goal: "Switch to the previous month",
  app: "Calendar",
  candidates: [
    { id: "i56", index: 56, role: "button", label: "previous month" },
    { id: "i58", index: 58, role: "button", label: "next month" },
  ],
  context: "September 2026",
  recentActions: [],
  constraints: "Do not edit events",
};

const successBody = {
  answers: {
    target: { choice: "i56", confidence: 0.96, probabilities: { i56: 0.96, i58: 0.04 } },
    action: { choice: "click_element" },
    done: { noul: 0.02 },
    risk: { noul: 0.01 },
  },
  usage: { input_tokens: 250 },
  model: "jev-1.13.0",
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    async json() {
      return body;
    },
  };
}

test("normalizes a valid Jev decision and sends only bounded state", async () => {
  const calls = [];
  const decision = await requestDecision(
    {
      ...validInput,
      accessibility_text: "RAW_AX_MUST_NOT_BE_SENT",
      candidates: [{
        ...validInput.candidates[0],
        label: `previous month https://example.com/${"x".repeat(300)}`,
      }],
    },
    {
      apiKey: "secret-key",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, successBody);
      },
    },
  );

  assert.deepEqual(
    {
      action: decision.action,
      targetId: decision.targetId,
      targetIndex: decision.targetIndex,
      done: decision.done,
      risk: decision.risk,
      confidence: decision.confidence,
      model: decision.model,
    },
    {
      action: "click_element",
      targetId: "i56",
      targetIndex: 56,
      done: 0.02,
      risk: 0.01,
      confidence: 0.96,
      model: "jev-1.13.0",
    },
  );
  const payload = calls[0].options.body;
  assert.equal(payload.includes("RAW_AX_MUST_NOT_BE_SENT"), false);
  assert.equal(payload.includes("https://example.com"), false);
  assert.ok(JSON.parse(payload).state.candidates[0].desc.length <= 120);
});

for (const status of [401, 403]) {
  test(`HTTP ${status} fails once with a non-secret authentication error`, async () => {
    let attempts = 0;
    await assert.rejects(
      requestDecision(validInput, {
        apiKey: "secret-key",
        fetchImpl: async () => {
          attempts += 1;
          return response(status, { detail: { message: "server echoed secret-key" } });
        },
      }),
      (error) => error instanceof JevError
        && error.code === "authentication_failed"
        && !error.message.includes("secret-key"),
    );
    assert.equal(attempts, 1);
  });
}

for (const [status, code] of [[429, "rate_limited"], [503, "service_unavailable"]]) {
  test(`HTTP ${status} retries twice and returns ${code}`, async () => {
    let attempts = 0;
    const delays = [];
    await assert.rejects(
      requestDecision(validInput, {
        apiKey: "secret-key",
        fetchImpl: async () => {
          attempts += 1;
          return response(status, {});
        },
        sleepImpl: async (delay) => delays.push(delay),
      }),
      (error) => error.code === code,
    );
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1_000, 3_000]);
  });
}

test("network failures retry twice and use a stable error without leaking the key", async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    requestDecision(validInput, {
      apiKey: "secret-key",
      fetchImpl: async () => {
        attempts += 1;
        throw new Error("socket failed near secret-key");
      },
      sleepImpl: async (delay) => delays.push(delay),
    }),
    (error) => error.code === "network_failed" && !error.message.includes("secret-key"),
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 3_000]);
});

test("missing answers and unknown target choices are invalid responses", async () => {
  for (const body of [
    { answers: {} },
    {
      ...successBody,
      answers: { ...successBody.answers, target: { choice: "i999", confidence: 1 } },
    },
  ]) {
    await assert.rejects(
      requestDecision(validInput, {
        apiKey: "secret-key",
        fetchImpl: async () => response(200, body),
      }),
      (error) => error.code === "invalid_response",
    );
  }
});
