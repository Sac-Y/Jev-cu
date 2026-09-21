import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePolicy, matchSensitive } from "../server/policy.mjs";

const safeDecision = {
  action: "click_element",
  targetId: "i56",
  targetIndex: 56,
  targetLabel: "button: previous month",
  confidence: 0.96,
  risk: 0.01,
  done: 0.02,
};

const gate = (decision, overrides = {}) => evaluatePolicy({
  decision,
  app: "Calendar",
  candidateIds: ["i56", "i58"],
  ...overrides,
});

test("safe Calendar navigation proceeds", () => {
  assert.equal(gate(safeDecision).verdict, "proceed");
});

test("a valid high done probability stops as done", () => {
  assert.equal(gate({ ...safeDecision, done: 0.95 }).verdict, "done");
});

test("an unknown target is escalated", () => {
  const result = gate({ ...safeDecision, targetId: "i999", targetIndex: 999 });
  assert.deepEqual([result.verdict, result.kind], ["escalate", "unknown_target"]);
});

test("missing or out-of-range probabilities are escalated", () => {
  for (const decision of [
    { ...safeDecision, risk: undefined },
    { ...safeDecision, done: 1.1 },
    { ...safeDecision, confidence: -0.1 },
  ]) {
    assert.equal(gate(decision).kind, "invalid_decision");
  }
});

test("very low confidence stops and intermediate confidence escalates", () => {
  assert.equal(gate({ ...safeDecision, confidence: 0.2 }).verdict, "stop");
  assert.equal(gate({ ...safeDecision, confidence: 0.35 }).verdict, "escalate");
});

test("low-risk apps use the documented relaxed confidence threshold", () => {
  assert.equal(gate({ ...safeDecision, confidence: 0.46 }).verdict, "proceed");
  assert.equal(gate(
    { ...safeDecision, confidence: 0.46 },
    { app: "NetEaseMusic" },
  ).verdict, "escalate");
});

test("sensitive Chinese and English labels require confirmation", () => {
  assert.equal(matchSensitive("按钮 删除歌曲").id, "delete");
  assert.equal(matchSensitive("button Send message").id, "send");
  assert.equal(gate({ ...safeDecision, targetLabel: "按钮 立即支付" }).verdict, "confirm");
});

test("disallowed apps, high risk, and ask_user require confirmation", () => {
  assert.equal(gate(safeDecision, { app: "UnknownApp" }).verdict, "confirm");
  assert.equal(gate({ ...safeDecision, risk: 0.8 }).verdict, "confirm");
  assert.equal(gate({ ...safeDecision, action: "ask_user" }).verdict, "confirm");
});

test("wait can proceed without a target while other actions cannot", () => {
  const noTarget = { ...safeDecision, targetId: null, targetIndex: null, targetLabel: null };
  assert.equal(gate({ ...noTarget, action: "wait" }).verdict, "proceed");
  assert.equal(gate(noTarget).kind, "no_target");
});
