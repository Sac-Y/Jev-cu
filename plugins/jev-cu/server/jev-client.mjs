import { sanitizeLabel } from "./candidates.mjs";

export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";
export const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000;

const ACTIONS = new Set([
  "click_element",
  "click_at",
  "drag",
  "set_value",
  "type_text",
  "press_key",
  "scroll",
  "wait",
  "ask_user",
]);

const defaultSleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

export class JevError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = "JevError";
    this.code = code;
    this.retryable = retryable;
  }
}

function toProbability(value) {
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function buildQuestions(goal, criteria) {
  return {
    target: {
      type: "choice",
      instructions: `Which single element should be acted on next to accomplish the goal? Goal: ${String(goal).slice(0, 500)}`,
      criteria,
    },
    action: {
      type: "choice",
      instructions: "What is the next action type?",
      criteria: {
        click_element: "Click the chosen element",
        click_at: "Click a canvas position supplied by the host",
        drag: "Drag between coordinates supplied by the host",
        set_value: "Replace the value of the chosen text input",
        type_text: "Type text supplied by the host",
        press_key: "Press a keyboard key supplied by the host",
        scroll: "Scroll the current view",
        wait: "Wait for the UI to update",
        ask_user: "Stop and ask the user",
      },
    },
    done: {
      type: "noul",
      instructions: "Is the goal already visibly achieved in the current UI state?",
    },
    risk: {
      type: "noul",
      instructions: "Does the next action require explicit user confirmation for deletion, sending, payment, permissions, sharing, installation, settings, CAPTCHA, or credentials?",
      criteria: {
        true: "sensitive or externally consequential action",
        false: "safe reversible navigation, searching, scrolling, selecting, or reading",
      },
    },
  };
}

function normalizeResponse(body, criteria, candidates) {
  const answers = body?.answers;
  const targetId = answers?.target?.choice;
  const action = answers?.action?.choice;
  const done = toProbability(answers?.done?.noul ?? answers?.done?.probability);
  const risk = toProbability(answers?.risk?.noul ?? answers?.risk?.probability);
  const confidence = toProbability(answers?.target?.confidence);
  const target = candidates.find((candidate) => candidate.id === targetId);

  if (!answers || !target || !Object.hasOwn(criteria, targetId) || !ACTIONS.has(action)
      || done === null || risk === null || confidence === null) {
    throw new JevError("invalid_response", "Jev returned an invalid decision");
  }

  return {
    action,
    targetId,
    targetIndex: target.index,
    targetLabel: criteria[targetId],
    done,
    risk,
    confidence,
    probabilities: answers.target?.probabilities ?? {},
  };
}

function errorForStatus(status) {
  if (status === 401 || status === 403) {
    return new JevError("authentication_failed", "Jev authentication failed");
  }
  if (status === 429) {
    return new JevError("rate_limited", "Jev rate limit exceeded", { retryable: true });
  }
  if (status >= 500) {
    return new JevError("service_unavailable", "Jev service is unavailable", { retryable: true });
  }
  return new JevError("invalid_response", `Jev request failed with HTTP ${status}`);
}

export async function requestDecision(input, {
  apiKey,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  maxRetries = 2,
  timeoutMs = 60_000,
} = {}) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new JevError("authentication_failed", "Jev credential is not configured");
  }
  if (typeof fetchImpl !== "function") {
    throw new JevError("network_failed", "Jev network transport is unavailable");
  }

  const candidates = Array.isArray(input?.candidates) ? input.candidates.slice(0, 80) : [];
  const criteria = Object.fromEntries(candidates.map((candidate) => [
    candidate.id ?? `i${candidate.index}`,
    sanitizeLabel(`${candidate.role}: ${candidate.label}`, 120),
  ]));
  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    id: candidate.id ?? `i${candidate.index}`,
  }));
  const payload = {
    state: {
      goal: String(input?.goal ?? "").slice(0, 500),
      app: String(input?.app ?? "").slice(0, 200),
      context: String(input?.context ?? "").slice(0, 1_500),
      candidates: Object.entries(criteria).map(([id, desc]) => ({ id, desc })),
      recent_actions: Array.isArray(input?.recentActions)
        ? input.recentActions.slice(-6).map((item) => String(item).slice(0, 300))
        : [],
      constraints: String(input?.constraints ?? "").slice(0, 1_500),
    },
    model,
    questions: buildQuestions(input?.goal ?? "", criteria),
  };
  const backoff = [1_000, 3_000];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    let response;
    let networkCause;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (cause) {
      networkCause = cause;
    } finally {
      clearTimeout(timer);
    }

    if (networkCause) {
      const error = new JevError(
        "network_failed",
        "Unable to reach the Jev service",
        { retryable: true, cause: networkCause },
      );
      if (attempt >= maxRetries) throw error;
      await sleepImpl(backoff[Math.min(attempt, backoff.length - 1)]);
      continue;
    }

    const latencyMs = Date.now() - startedAt;
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.ok) {
      const decision = normalizeResponse(body, criteria, normalizedCandidates);
      const inputTokens = Number(body?.usage?.input_tokens ?? body?.usage?.inputTokens ?? 0) || 0;
      return {
        ...decision,
        usage: { inputTokens },
        latencyMs,
        costUsd: inputTokens * PRICE_PER_INPUT_TOKEN_USD,
        model: String(body?.model ?? model),
      };
    }

    const error = errorForStatus(response.status);
    if (!error.retryable || attempt >= maxRetries) throw error;
    await sleepImpl(backoff[Math.min(attempt, backoff.length - 1)]);
  }

  throw new JevError("service_unavailable", "Jev service is unavailable", { retryable: true });
}
