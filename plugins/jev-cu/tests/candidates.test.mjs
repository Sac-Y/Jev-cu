import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  collectCandidates,
  parseAccessibilitySnapshot,
} from "../server/candidates.mjs";

const readFixture = (name) =>
  fs.readFileSync(new URL(`../fixtures/ax/${name}`, import.meta.url), "utf8");

test("Chinese overlapping roles use longest matching alias", () => {
  const elements = parseAccessibilitySnapshot(readFixture("activity-monitor-zh.txt"));
  assert.deepEqual(
    elements.find((item) => item.index === 3),
    { index: 3, role: "radio button", label: "CPU, Value: 1, ID: cpu-tab", depth: 8 },
  );
  assert.equal(elements.find((item) => item.index === 2).role, "button");
  assert.equal(elements.find((item) => item.index === 4).role, "checkbox");
  assert.equal(elements.find((item) => item.index === 5).role, "text field");
});

test("English parsing removes secondary-action metadata", () => {
  const elements = parseAccessibilitySnapshot(readFixture("calendar-en.txt"));
  assert.deepEqual(
    elements.find((item) => item.index === 64),
    { index: 64, role: "button", label: "Description: Add Event", depth: 8 },
  );
});

test("candidate ranking is bounded and keeps a goal-matching tail item", () => {
  const snapshot = Array.from({ length: 45 }, (_, index) => `${index} button item ${index}`).join("\n");
  const result = collectCandidates(snapshot, "open item 44", { max: 40 });

  assert.equal(result.candidates.length, 40);
  assert.equal(result.diagnostics.clipped, true);
  assert.equal(result.diagnostics.totalClickable, 45);
  assert.deepEqual(result.candidates[0], {
    id: "i44",
    index: 44,
    role: "button",
    label: "item 44",
  });
});

test("unknown roles remain visible in diagnostics", () => {
  const result = collectCandidates("0 神秘控件 Example", "example");
  assert.deepEqual(result.diagnostics.unknownRoles, ["神秘控件"]);
  assert.equal(result.candidates.length, 0);
});

test("candidate maximum is clamped to the supported range", () => {
  const snapshot = Array.from({ length: 90 }, (_, index) => `${index} button item ${index}`).join("\n");
  assert.equal(collectCandidates(snapshot, "item", { max: 500 }).candidates.length, 80);
  assert.equal(collectCandidates(snapshot, "item", { max: 0 }).candidates.length, 1);
});

test("context is bounded and preserves the visible state", () => {
  const result = collectCandidates(readFixture("calendar-en.txt"), "previous month");
  assert.match(result.context, /Calendar/);
  assert.match(result.context, /September 2026/);
  assert.ok(result.context.length <= 1_500);
});
