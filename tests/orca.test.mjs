import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOrcaDriver, normalizeOrcaAX } from "../scripts/orca-driver.mjs";
import { parseAX, selectCandidates, runTask } from "../scripts/loop.mjs";

const tree = 'App=com.apple.iCal\nWindow: "캘린더"\n0 표준 윈도우 캘린더\n\t11 체크상자, Value: 1\n\t91 버튼 지난달\n\t187 버튼 다음 달\n\t198 라디오 버튼 주, Value: 0\n\t199 라디오 버튼 월, Value: 1';
function harness({ failAction = false, truncated = false } = {}) {
  const calls = [];
  let current = tree;
  const driver = createOrcaDriver({ appSelector: "com.apple.iCal", sessionId: "test-session",
    invoke: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[1] === "get-app-state") return JSON.stringify({ ok: true, result: {
        snapshot: { treeText: current, window: { id: 42 }, truncation: { truncated } },
      } });
      if (failAction) return JSON.stringify({ ok: false, error: { code: "action_timeout" } });
      if (args[1] === "click") current = current.replace("주, Value: 0", "주, Value: 1");
      return JSON.stringify({ ok: true, result: {} });
    },
  });
  return { driver, calls };
}

test("Korean and comma-delimited roles retain sparse indexes and selected state", () => {
  const ax = normalizeOrcaAX(tree);
  const els = parseAX(ax);
  assert.equal(els.find(e => e.index === 11).role, "checkbox");
  assert.equal(els.find(e => e.index === 199).role, "radio button");
  assert.match(els.find(e => e.index === 199).label, /Value: 1/);
  assert.ok(selectCandidates(els).some(e => e.index === 187 && e.label === "다음 달"));
  assert.equal(normalizeOrcaAX(ax), ax);
});

test("Actions pin the observed window and invalidate indexes until a new observation", async () => {
  const { driver, calls } = harness();
  await driver.bind("Calendar");
  await assert.rejects(driver.click(198), /stale/);
  await driver.observe();
  await assert.rejects(driver.click(999), /stale/);
  await driver.click(198);
  assert.deepEqual(calls[1].args.slice(0, 8), ["computer", "click", "--app", "com.apple.iCal", "--session", "test-session", "--window-id", "42"]);
  await assert.rejects(driver.click(198), /stale/);
  assert.equal(calls.length, 2);
  await driver.observe();
  await driver.click(199);
});

test("Sensitive text is passed through stdin, never CLI arguments", async () => {
  const { driver, calls } = harness();
  await driver.bind("Calendar");
  await driver.observe();
  await driver.setValue(91, 'synthetic-private-value $(echo unsafe)');
  const call = calls.at(-1);
  assert.ok(call.args.includes("--value-stdin"));
  assert.ok(!call.args.join(" ").includes("synthetic-private-value"));
  assert.equal(call.options.input, 'synthetic-private-value $(echo unsafe)');
});

test("Ambiguous failed actions cannot be replayed without observation", async () => {
  const { driver, calls } = harness({ failAction: true });
  await driver.bind("Calendar");
  await driver.observe();
  await assert.rejects(driver.click(198), /action_timeout/);
  await assert.rejects(driver.click(198), /stale/);
  assert.equal(calls.length, 2);
});

test("Truncated trees and malformed CLI output fail closed", async () => {
  const { driver } = harness({ truncated: true });
  await driver.bind("Calendar");
  await assert.rejects(driver.observe(), /truncated/);
  await assert.rejects(driver.click(198), /stale/);
  const bad = createOrcaDriver({ invoke: async () => "not-json" });
  await bad.bind("Calendar");
  await assert.rejects(bad.observe(), /invalid JSON/);
});

test("The Jev loop works through Orca and requires a verified selected state", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-orca-test-"));
  try {
    for (const dryRun of [true, false]) {
      const { driver, calls } = harness();
      const result = await runTask({ driver, appName: "Calendar", goal: "Switch to Week view",
        dryRun, maxSteps: 1, traceDir, emit: () => {},
        verify: ax => /198 radio button 주, Value: 1/.test(ax),
        decide: async ({ candidates }) => {
          assert.ok(candidates.some(c => c.index === 198));
          return { action: "click_element", targetIndex: 198, targetLabel: "주", confidence: 1, done: 0, risk: 0 };
        },
      });
      assert.equal(result.status, dryRun ? "dry_run" : "done");
      assert.equal(calls.filter(c => c.args[1] === "click").length, dryRun ? 0 : 1);
      if (!dryRun) assert.equal(result.verified, true);
    }
  } finally { fs.rmSync(traceDir, { recursive: true, force: true }); }
});
