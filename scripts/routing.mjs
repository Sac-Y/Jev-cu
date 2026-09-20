/** Optional chooser-to-planner boundary. A route is never permission to act. */
export const ROUTE_CRITERIA = {
  execute: "The next step is a bounded UI action supported by the supplied text state and prepared inputs. No additional reasoning or visual interpretation is needed.",
  reobserve: "A fresh UI observation could supply missing or stale evidence for this bounded step. Do not keep rereading when the required evidence is visual or the task needs a planner.",
  reasoning: "Hand the subgoal to the caller's reasoning planner: interpreting or generating content, resolving conflicting requirements, or replanning exceeds a bounded UI choice.",
  vision: "Hand the subgoal to the caller's visual planner: deciding needs screenshot, canvas, image, color or spatial evidence absent from the text state.",
};

export function routingOptions(value = false) {
  if (value === false) return null;
  if (value !== true && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new TypeError("routing must be false, true, or an options object");
  }
  const options = {
    minConfidence: 0.5,
    maxReobservations: 1,
    maxNoProgress: 2,
    handoffTimeoutMs: 30_000,
    requirePlanner: null,
    ...(value === true ? {} : value),
  };
  if (!Number.isFinite(options.minConfidence) || options.minConfidence < 0 || options.minConfidence > 1) {
    throw new TypeError("routing.minConfidence must be between 0 and 1");
  }
  for (const key of ["maxReobservations", "maxNoProgress", "handoffTimeoutMs"]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < (key === "maxReobservations" ? 0 : 1)) {
      throw new TypeError(`routing.${key} must be a bounded nonnegative/positive integer`);
    }
  }
  if (options.handoffTimeoutMs > 2_147_483_647) throw new TypeError("routing.handoffTimeoutMs exceeds the timer limit");
  if (options.requirePlanner !== null && !["reasoning", "vision"].includes(options.requirePlanner)) {
    throw new TypeError("routing.requirePlanner must be reasoning or vision");
  }
  return options;
}

export function checkRoute(decision, options) {
  if (!decision || !Object.hasOwn(ROUTE_CRITERIA, decision.route) ||
      !Number.isFinite(decision.routeConfidence) || decision.routeConfidence < 0 || decision.routeConfidence > 1) {
    return { route: "handoff", reason: "invalid_route" };
  }
  if (decision.routeConfidence < options.minConfidence) {
    return { route: "handoff", reason: "uncertain_route" };
  }
  if (["reasoning", "vision"].includes(decision.route)) {
    return { route: "handoff", reason: decision.route };
  }
  return { route: decision.route };
}

/** The host owns the provider and must honor signal; no planner output is executed. */
export async function callPlanner(callback, request, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => callback(request, { signal: controller.signal }))
        .then(value => ({ status: "completed", value }), () => ({ status: "error" })),
      new Promise(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "timeout" });
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
