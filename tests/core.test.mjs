import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, createCuaDriver, createCuaTabDriver, parseAX, selectCandidates } from "../scripts/loop.mjs";
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

test("Windows 原生 App 使用精确 windowId 绑定", async () => {
  let boundTarget;
  const app = {};
  const driver = createCuaDriver({
    getApp: async (target) => { boundTarget = target; return app; },
  }, { windowId: 123 });
  assert.equal(await driver.bind("ignored-on-windows"), app);
  assert.deepEqual(boundTarget, { windowId: 123 });
});

test("浏览器 Tab driver 传递元素索引给输入与按键", async () => {
  const calls = [];
  const tab = {
    getAXState: async (options) => { calls.push(["observe", options]); return CALENDAR_AX; },
    click: async (...args) => calls.push(["click", ...args]),
    drag: async (...args) => calls.push(["drag", ...args]),
    setValue: async (...args) => calls.push(["setValue", ...args]),
    typeText: async (...args) => calls.push(["typeText", ...args]),
    pressKey: async (...args) => calls.push(["pressKey", ...args]),
    scroll: async (...args) => calls.push(["scroll", ...args]),
  };
  const driver = createCuaTabDriver(tab);
  assert.equal(await driver.bind("Browser"), tab);
  await driver.observe({ full: true });
  await driver.typeText("hello", 7);
  await driver.pressKey("Return", 7);
  assert.deepEqual(calls, [
    ["observe", { emit: false, disableDiffing: true }],
    ["typeText", 7, "hello"],
    ["pressKey", 7, "Return"],
  ]);
});

test("Windows 浏览器 AX 角色包含多行文本与时间字段", () => {
  const ax = [
    "1 AXWebArea Form",
    "\t2 text entry area (settable) Notes",
    "\t3 time field (settable) Delivery time",
  ].join("\n");
  const candidates = selectCandidates(parseAX(ax), "fill delivery notes and time");
  assert.deepEqual(candidates.map(({ index, role }) => ({ index, role })), [
    { index: 3, role: "time field" },
    { index: 2, role: "text entry area" },
  ]);
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
  assert.deepEqual(observations, [true, true]);
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
