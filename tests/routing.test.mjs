import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { runTask } from "../scripts/loop.mjs";
import { decide, buildQuestions } from "../scripts/jev-decide.mjs";

const AX = 'Window: "Calendar", App: Calendar.\n0 standard window Calendar\n1 button Next\n2 button Today\n3 text September';
const ACTION = { action: "click_element", targetIndex: 1, targetLabel: "Next", confidence: 1, risk: 0, done: 0 };
const ROUTED = { ...ACTION, route: "execute", routeConfidence: 1 };

async function run(options = {}, inspect = () => {}) {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-routing-"));
  const stats = { actions: 0, observations: 0, calls: 0 };
  let ax = AX;
  try {
    const driver = {
      bind: async () => {},
      observe: async () => { stats.observations++; return ax; },
      click: async () => { stats.actions++; if (options.advance) ax += `\n${10 + stats.actions} text changed`; },
    };
    const chooser = options.decide ?? (async () => ROUTED);
    const result = await runTask({
      appName: "Calendar", goal: "Next", dryRun: false, maxSteps: 5, routing: true,
      emit: () => {}, ...options, traceDir, driver,
      decide: async input => { stats.calls++; return chooser(input, stats.calls); },
    });
    await inspect(result, stats, fs.readFileSync(result.tracePath, "utf8"));
    return { result, stats };
  } finally {
    fs.rmSync(traceDir, { recursive: true, force: true });
  }
}

test("default request remains four questions; routing shares one provider request", async () => {
  assert.equal(Object.keys(buildQuestions("Next", []).questions).length, 4);
  let requests = 0;
  const result = await decide({
    goal: "Next", candidates: [{ index: 1, role: "button", label: "Next" }], routing: true,
    apiKey: "test-only", fetchImpl: async (_url, init) => {
      requests++;
      const body = JSON.parse(init.body);
      assert.equal(Object.keys(body.questions).length, 5);
      assert.deepEqual(Object.keys(body.questions.route.criteria), ["execute", "reobserve", "reasoning", "vision"]);
      return { ok: true, json: async () => ({ answers: {
        route: { choice: "reasoning", confidence: 0.9 }, target: { choice: "i1", confidence: 1 },
        action: { choice: "click_element" }, risk: { noul: 0 }, done: { noul: 0 },
      } }) };
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.route, "reasoning");
  assert.equal(result.routeConfidence, 0.9);
});

test("routing disabled preserves the legacy no-change loop and ignores a planner callback", async () => {
  const { result, stats } = await run({ routing: false, maxSteps: 3,
    decide: async input => { assert.equal(input.routing, false); return ACTION; },
    onHandoff: () => { throw Error("must not call"); },
  });
  assert.equal(result.status, "max_steps");
  assert.equal(stats.actions, 3);
});

test("ordinary routed action uses one chooser call and retains independent verification", async () => {
  const { result, stats } = await run({ advance: true, verify: ax => ax.includes("changed") });
  assert.equal(result.status, "done");
  assert.equal(result.verified, true);
  assert.equal(stats.calls, 1);
  assert.equal(stats.actions, 1);
});

for (const route of ["reasoning", "vision"]) {
  test(`${route} hands off once and never executes unused action or planner output`, async () => {
    let callbacks = 0;
    await run({ decide: async () => ({ ...ROUTED, route, targetIndex: 999, done: 1 }),
      resources: () => ({ jevGoal: "Interpret the current view", text: "private prepared input" }),
      onHandoff: async (request, { signal }) => {
        callbacks++;
        assert.equal(request.reason, route);
        assert.equal(request.subgoal, "Interpret the current view");
        assert.ok(request.context.length <= 1500);
        assert.ok(!JSON.stringify(request).includes("private prepared input"));
        assert.equal(signal.aborted, false);
        return { action: "click_element", targetIndex: 999, privatePlannerText: "not in trace" };
      },
    }, (result, stats, trace) => {
      assert.equal(result.status, "handoff");
      assert.equal(result.plannerStatus, "completed");
      assert.equal(result.plannerResult.targetIndex, 999);
      assert.equal(stats.actions, 0);
      assert.equal(callbacks, 1);
      assert.ok(!trace.includes("privatePlannerText"));
    });
  });
}

test("dry-run never invokes the planner, including a mandatory capability handoff", async () => {
  for (const routing of [true, { requirePlanner: "vision" }]) {
    const { result, stats } = await run({ dryRun: true, routing,
      decide: async () => ({ route: "reasoning", routeConfidence: 1 }),
      onHandoff: () => { assert.fail("planner invoked during preview"); },
    });
    assert.equal(result.status, "dry_run");
    assert.equal(result.plannerStatus, "not_called");
    assert.equal(stats.actions, 0);
  }
});

test("known capability gap bypasses the chooser altogether", async () => {
  const { result, stats } = await run({ routing: { requirePlanner: "vision" } });
  assert.equal(result.status, "handoff");
  assert.equal(result.handoff.reason, "vision");
  assert.equal(stats.calls, 0);
});

test("uncertain, missing, and invalid route output cannot execute a high-confidence action", async () => {
  for (const patch of [{ route: undefined }, { route: "unknown" }, { routeConfidence: NaN }, { routeConfidence: 0.1 }]) {
    const { result, stats } = await run({ decide: async () => ({ ...ROUTED, ...patch }) });
    assert.equal(result.status, "handoff");
    assert.equal(stats.actions, 0);
    assert.ok(["invalid_route", "uncertain_route"].includes(result.handoff.reason));
  }
});

test("reobserve uses a fresh full observation and ignores its unused action", async () => {
  const { result, stats } = await run({ advance: true, verify: ax => ax.includes("changed"),
    decide: async (_input, n) => n === 1 ? { ...ROUTED, route: "reobserve", targetIndex: 999 } : ROUTED,
  });
  assert.equal(result.status, "done");
  assert.equal(result.steps, 1);
  assert.equal(stats.calls, 2);
  assert.equal(stats.observations, 3);
  assert.equal(stats.actions, 1);
});

test("reobserve budget is finite even when Jev keeps asking", async () => {
  const { result, stats } = await run({ decide: async () => ({ ...ROUTED, route: "reobserve" }) });
  assert.equal(result.status, "handoff");
  assert.equal(result.handoff.reason, "reobserve_budget");
  assert.equal(stats.calls, 2);
  assert.equal(stats.actions, 0);
});

test("high-confidence actions stop after two unchanged observations", async () => {
  const { result, stats } = await run();
  assert.equal(result.status, "handoff");
  assert.equal(result.handoff.reason, "no_observed_progress");
  assert.equal(result.steps, 2);
  assert.equal(stats.actions, 2);
  assert.equal(stats.calls, 2);
});

test("observable progress resets the counter and a completed goal wins over no-progress", async () => {
  const { result, stats } = await run({ advance: true, maxSteps: 3 });
  assert.equal(result.status, "max_steps");
  assert.equal(stats.actions, 3);
  let verified = 0;
  const done = await run({ verify: () => ++verified === 4 });
  assert.equal(done.result.status, "done");
  assert.equal(done.result.verified, true);
});

test("route execute never overrides the existing action policy", async () => {
  const { result, stats } = await run({ decide: async () => ({ ...ROUTED, risk: 0.9 }) });
  assert.equal(result.status, "confirm");
  assert.equal(stats.actions, 0);
});

test("planner failures and deadlines return handoff without replay", async () => {
  for (const mode of ["error", "timeout"]) {
    let signal;
    const { result, stats } = await run({ routing: { requirePlanner: "reasoning", handoffTimeoutMs: 10 },
      onHandoff: async (_request, options) => {
        signal = options.signal;
        if (mode === "error") throw Error("provider failure");
        return new Promise(() => {});
      },
    });
    assert.equal(result.status, "handoff");
    assert.equal(result.plannerStatus, mode);
    assert.equal(stats.actions, 0);
    if (mode === "timeout") assert.equal(signal.aborted, true);
  }
});

test("routing configuration rejects invalid budgets before observing an app", async () => {
  for (const routing of [null, "yes", { maxNoProgress: 0 }, { maxReobservations: -1 }, { minConfidence: NaN }, { requirePlanner: "unknown" }, { handoffTimeoutMs: 2 ** 40 }]) {
    await assert.rejects(runTask({ routing, driver: { bind: () => assert.fail("unexpected bind") } }), TypeError);
  }
});

test("a malformed chooser response routes to the host instead of throwing or acting", async () => {
  const { result, stats } = await run({ decide: async () => null });
  assert.equal(result.handoff.reason, "invalid_route");
  assert.equal(stats.actions, 0);
});

test("fresh observation can verify success without counting an action", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-routing-observe-"));
  let reads = 0;
  try {
    const result = await runTask({
      appName: "Calendar", goal: "Wait for October", routing: true, dryRun: false,
      traceDir, emit: () => {}, verify: ax => ax.includes("October"),
      driver: { bind: async () => {}, observe: async () => ++reads === 1 ? AX : AX.replace("September", "October") },
      decide: async () => ({ route: "reobserve", routeConfidence: 1 }),
    });
    assert.equal(result.status, "done");
    assert.equal(result.steps, 0);
    assert.equal(result.verified, true);
  } finally { fs.rmSync(traceDir, { recursive: true, force: true }); }
});

test("a caller-owned loopback chooser works without a TypeSafe client or key", async () => {
  let requests = 0;
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    const input = JSON.parse(body);
    requests++;
    assert.equal(input.routing, true);
    assert.equal(input.goal, "Next");
    assert.ok(input.candidates.some(c => c.index === ROUTED.targetIndex));
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(ROUTED));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const { result, stats } = await run({ advance: true, verify: ax => ax.includes("changed"),
      decide: async ({ goal, candidates, context, routing }) => {
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, candidates, context, routing }),
        });
        return response.json();
      },
    });
    assert.equal(result.status, "done");
    assert.equal(result.verified, true);
    assert.equal(stats.actions, 1);
    assert.equal(requests, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
