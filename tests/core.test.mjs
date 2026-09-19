import test from "node:test";
import assert from "node:assert/strict";
import { parseAX, selectCandidates, buildContext } from "../scripts/loop.mjs";
import { evaluatePolicy, matchSensitive } from "../scripts/policy.mjs";
import { buildQuestions, normalizeDecision, sanitizeLabel } from "../scripts/jev-decide.mjs";

const CALENDAR_AX = [
  'Window: "Calendar", App: Calendar.',
  '0 standard window Calendar, ID: CALMainWindow, Secondary Actions: Raise',
  "\t1 split group",
  "\t\t2 container Description: Month Calendar Area, Value: 9/18/26, ID: active-view",
  "\t\t\t4 list Sunday, August 30",
  "\t\t\t5 list Monday, August 31",
  "\t\t\t6 list Tuesday, September 1",
  "\t\t\t7 list Wednesday, September 2",
  "\t\t\t8 list Thursday, September 3",
  "\t\t\t9 list Friday, September 4",
  "\t\t\t10 list Saturday, September 5",
  "\t\t\t11 list Sunday, September 6",
  "\t\t\t12 list Monday, September 7",
  "\t\t\t13 Event Description: Labor Day. September 7, 2026, All-Day",
  "\t17 list Tuesday, September 8",
  "\t24 list Sunday, September 13",
  "\t31 list Today, Friday, September 18",
  "\t\t\t56 button previous month",
  "\t\t\t57 button Today, ID: today-button",
  "\t\t\t58 button next month",
  "\t\t59 text Value: September 2026, ID: view-date-title",
  "\t60 toolbar",
  "\t\t64 button Description: Add Event",
  "\t\t71 button Search",
  "\t72 close button",
  "The focused UI element is 2 container Description: Month Calendar Area",
].join("\n");

test("parseAX 解析索引/角色/标签", () => {
  const els = parseAX(CALENDAR_AX);
  const prev = els.find((e) => e.index === 56);
  assert.equal(prev.role, "button");
  assert.equal(prev.label, "previous month");
  const field = els.find((e) => e.index === 57);
  assert.equal(field.role, "button");
});

test("selectCandidates 不会把目标按钮挤出候选集（P0 实测回归）", () => {
  const els = parseAX(CALENDAR_AX);
  const candidates = selectCandidates(els, "switch the calendar to the previous month", { max: 40 });
  const indices = candidates.map((c) => c.index);
  assert.ok(indices.includes(56), "previous month 按钮必须在候选集中");
  assert.ok(indices.includes(58), "next month 按钮必须在候选集中");
  // 日历日期格仍可选择；翻月按钮应排在无关日期前。
  assert.ok(indices.indexOf(56) < indices.indexOf(4));
});

test("selectCandidates 在 max 很小时仍优先保留按钮", () => {
  const els = parseAX(CALENDAR_AX);
  const candidates = selectCandidates(els, "previous month", { max: 3 });
  assert.ok(candidates.map((c) => c.index).includes(56));
});

test("buildContext 只取少量上下文", () => {
  const ctx = buildContext(CALENDAR_AX);
  assert.ok(ctx.includes("Calendar"));
  assert.ok(ctx.includes("September 2026"), "应包含关键文本状态（当前月份）");
  assert.ok(ctx.split("\n").length <= 9);
});

test("buildContext 带上计算器显示值", () => {
  const calcAx = ['Window: "Calculator", App: Calculator.', '0 standard window Calculator', '\t4 text ‎42', '\t24 button Equals'].join("\n");
  const ctx = buildContext(calcAx);
  assert.ok(ctx.includes("42"), "Jev 必须能看到当前显示值");
});

test("policy：完成概率高 → done", () => {
  const gate = evaluatePolicy({ decision: { done: 0.95, confidence: 1, targetIndex: 56 }, app: "Calendar" });
  assert.equal(gate.verdict, "done");
});

test("policy：敏感目标 → confirm", () => {
  const gate = evaluatePolicy({
    decision: { done: 0.01, risk: 0.01, confidence: 0.99, targetIndex: 12, targetLabel: "button 删除歌曲" },
    app: "NetEaseMusic",
  });
  assert.equal(gate.verdict, "confirm");
});

test("policy：高风险判定 → confirm", () => {
  const gate = evaluatePolicy({
    decision: { done: 0.01, risk: 0.8, confidence: 0.99, targetIndex: 12, targetLabel: "button download" },
    app: "NetEaseMusic",
  });
  assert.equal(gate.verdict, "confirm");
});

test("policy：低置信度分级 stop / escalate", () => {
  const stop = evaluatePolicy({ decision: { done: 0.1, risk: 0.01, confidence: 0.2, targetIndex: 1 }, app: "Calendar" });
  assert.equal(stop.verdict, "stop");
  // Calendar 属零副作用 App（下限 0.4），0.35 仍应升级
  const esc = evaluatePolicy({ decision: { done: 0.1, risk: 0.01, confidence: 0.35, targetIndex: 1 }, app: "Calendar" });
  assert.equal(esc.verdict, "escalate");
  // 非零副作用 App（下限 0.5），0.45 应升级
  const esc2 = evaluatePolicy({ decision: { done: 0.1, risk: 0.01, confidence: 0.45, targetIndex: 1 }, app: "NetEaseMusic" });
  assert.equal(esc2.verdict, "escalate");
});

test("policy：零副作用 App 置信度 0.46 放行，其他 App 仍升级", () => {
  const calc = evaluatePolicy({ decision: { done: 0.1, risk: 0.03, confidence: 0.46, targetIndex: 24, targetLabel: "button: Equals" }, app: "Calculator" });
  assert.equal(calc.verdict, "proceed");
  const netease = evaluatePolicy({ decision: { done: 0.1, risk: 0.03, confidence: 0.46, targetIndex: 24, targetLabel: "link: 播放" }, app: "NetEaseMusic" });
  assert.equal(netease.verdict, "escalate");
});

test("policy：白名单外的 App → confirm", () => {
  const gate = evaluatePolicy({ decision: { done: 0.1, risk: 0, confidence: 1, targetIndex: 1 }, app: "UnknownApp" });
  assert.equal(gate.verdict, "confirm");
});

test("matchSensitive 命中支付与发送", () => {
  assert.equal(matchSensitive("button 立即支付").id, "payment");
  assert.equal(matchSensitive("button Send message").id, "send");
  assert.equal(matchSensitive("button Search"), null);
});

test("buildQuestions/normalizeDecision 往返一致", () => {
  const candidates = [
    { index: 56, role: "button", label: "previous month" },
    { index: 58, role: "button", label: "next month" },
  ];
  const { questions, criteria } = buildQuestions("go to the previous month", candidates);
  assert.ok(questions.target.criteria.i56.includes("previous month"));
  assert.ok(questions.action.criteria.drag, "动作类型应包含 drag");
  const decision = normalizeDecision(
    {
      target: { choice: "i56", confidence: 1, probabilities: { i56: 1, i58: 0 } },
      action: { choice: "click_element" },
      done: { noul: 0.04 },
      risk: { noul: 0.01 },
    },
    criteria,
  );
  assert.equal(decision.targetIndex, 56);
  assert.equal(decision.action, "click_element");
  assert.equal(decision.done, 0.04);
});

test("sanitizeLabel 去掉长 URL 并限长", () => {
  const raw = "link: 下载管理, Value: orpheus://orpheus/pub/app.html?resizable=true&x=0&y=0&width=1470#/m/offline/complete/";
  const clean = sanitizeLabel(raw);
  assert.ok(!clean.includes("orpheus://"));
  assert.ok(clean.includes("下载管理"));
  assert.ok(clean.length <= 120);
});

// 执行边界回归：全部使用模拟 driver，不操作真实 App、不调用网络。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTask } from "../scripts/loop.mjs";

async function mockRun(options) {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-test-"));
  try {
    return await runTask({ appName: "Calendar", goal: "next month", emit: () => {}, traceDir, ...options });
  } finally {
    fs.rmSync(traceDir, { recursive: true, force: true });
  }
}

test("Planner 预览无动作，真实执行交给接管", async () => {
  let actions = 0;
  const driver = { bind: async () => {}, observe: async () => CALENDAR_AX, typeText: async () => { actions++; } };
  for (const dryRun of [true, false]) {
    const result = await mockRun({ driver, dryRun, maxSteps: 1, resources: () => ({ skipJev: true, action: "type_text", text: "test" }) });
    assert.equal(result.status, dryRun ? "dry_run" : "escalate");
  }
  assert.equal(actions, 0);
});

test("完成以最终状态核验，最后一步之后也检查", async () => {
  let ax = CALENDAR_AX;
  const observations = [];
  const driver = {
    bind: async () => {},
    observe: async ({ full }) => { observations.push(full); return ax; },
    click: async () => { ax = ax.replace("September 2026", "October 2026"); },
  };
  const result = await mockRun({ driver, dryRun: false, maxSteps: 1,
    decide: async () => ({ action: "click_element", targetIndex: 58, targetLabel: "next month", confidence: 1, risk: 0, done: 0 }),
    verify: text => text.includes("October 2026"),
  });
  assert.equal(result.status, "done");
  assert.equal(result.verified, true);
  assert.deepEqual(observations, [true, true, true]);
});

test("Jev 自报完成不能覆盖失败的结果核验", async () => {
  const result = await mockRun({ driver: { bind: async () => {}, observe: async () => CALENDAR_AX },
    dryRun: false, maxSteps: 1, verify: () => false,
    decide: async () => ({ done: 0.99, confidence: 1 }),
  });
  assert.equal(result.status, "escalate");
});

test("未知目标和缺失概率不放行", () => {
  const decision = normalizeDecision({ target: { choice: "i999" }, action: { choice: "click_element" } }, { i1: "button A" });
  assert.equal(decision.targetIndex, null);
  assert.equal(evaluatePolicy({ decision, app: "Calendar" }).verdict, "escalate");
});


const NEXT_DECISION = { action: "click_element", targetIndex: 58, targetLabel: "next month", confidence: 1, risk: 0, done: 0 };

test("决策期间完整界面变化时，不执行旧索引", async () => {
  for (const changed of [
    CALENDAR_AX.replace("58 button next month", "58 button Delete event"),
    CALENDAR_AX.replace("58 button next month", "58 button (disabled) next month"),
    CALENDAR_AX.replace("September 2026", "October 2026"),
    CALENDAR_AX.replace("Month Calendar Area", "Different calendar"),
  ]) {
    let ax = CALENDAR_AX, actions = 0;
    const result = await mockRun({
      driver: { bind: async () => {}, observe: async () => ax, click: async () => { actions++; } },
      dryRun: false, maxSteps: 1,
      decide: async () => { ax = changed; return NEXT_DECISION; },
    });
    assert.equal(actions, 0);
    assert.equal(result.status, "escalate");
    assert.equal(result.reason, "observation_changed_before_action");
  }
});

test("异步资源回调之后再检查界面", async () => {
  let ax = CALENDAR_AX, actions = 0;
  const result = await mockRun({
    driver: { bind: async () => {}, observe: async () => ax, click: async () => { actions++; } },
    dryRun: false, maxSteps: 1, decide: async () => NEXT_DECISION,
    resources: async (_step, decision) => {
      if (decision) ax = ax.replace("58 button next month", "58 button Delete event");
      return {};
    },
  });
  assert.equal(actions, 0);
  assert.equal(result.reason, "observation_changed_before_action");
});

test("执行前观测失败时交回，不执行动作", async () => {
  let reads = 0, actions = 0;
  const result = await mockRun({
    driver: { bind: async () => {}, observe: async () => {
      if (++reads > 1) throw new Error("AX unavailable");
      return CALENDAR_AX;
    }, click: async () => { actions++; } },
    dryRun: false, maxSteps: 1, decide: async () => NEXT_DECISION,
  });
  assert.equal(actions, 0);
  assert.equal(result.status, "escalate");
  assert.equal(result.reason, "pre_action_observation_failed");
});

test("动作返回错误时不重放可能已发生的 mutation", async () => {
  let actions = 0;
  const result = await mockRun({
    driver: { bind: async () => {}, observe: async () => CALENDAR_AX,
      click: async () => { actions++; throw new Error("timeout after dispatch"); } },
    dryRun: false, maxSteps: 3, decide: async () => NEXT_DECISION,
  });
  assert.equal(actions, 1);
  assert.equal(result.status, "error");
});

test("Jev dry-run 无动作且不多读执行前状态", async () => {
  let reads = 0, actions = 0;
  const result = await mockRun({
    driver: { bind: async () => {}, observe: async () => { reads++; return CALENDAR_AX; },
      click: async () => { actions++; } },
    dryRun: true, maxSteps: 1, decide: async () => NEXT_DECISION,
  });
  assert.equal(result.status, "dry_run");
  assert.equal(actions, 0);
  assert.equal(reads, 1);
});
