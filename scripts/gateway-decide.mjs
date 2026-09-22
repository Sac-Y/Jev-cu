#!/usr/bin/env node
/**
 * Jev decision adapter for the Vercel AI Gateway evaluation-model API.
 *
 * The default path remains scripts/jev-decide.mjs (direct TypeSafe API).
 * This adapter keeps the existing decision shape so it can be passed to
 * runTask without changing the Computer Use loop or its policy gate.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQuestions, loadApiKey, normalizeDecision } from "./jev-decide.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";
export const GATEWAY_MODEL = "typesafe-ai/jev";
export const GATEWAY_PROTOCOL_VERSION = "0.0.1";
export const GATEWAY_SPECIFICATION_VERSION = "4";
export const DEFAULT_GATEWAY_TIMEOUT_MS = 20_000;

const REQUIRED_QUESTIONS = ["target", "action", "done", "risk"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function toProbability(value) {
  const number = toFiniteNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function assertProbability(value, label) {
  if (toProbability(value) === null) {
    throw new Error(`Jev Gateway response has invalid ${label}`);
  }
}

function gatewayError(message, { status, code, cause } = {}) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  if (status !== undefined) error.status = status;
  if (code !== undefined) error.code = code;
  return error;
}

/**
 * Convert the repository's native `noul` questions to the Vercel evaluation
 * model's `boolean` representation without mutating the direct-API payload.
 */
export function toGatewayQuestions(questions) {
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    throw new Error("Jev Gateway requires a nonempty question map");
  }

  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => {
      if (!isRecord(question) || typeof question.type !== "string") {
        throw new Error(`Jev Gateway question ${id} is invalid`);
      }
      if (question.type !== "noul") return [id, { ...question }];

      // Vercel's boolean contract permits optional true/false criteria. The
      // existing Jev questions already use that shape, so preserve it.
      return [id, { ...question, type: "boolean" }];
    }),
  );
}

/** Build the bounded, stringified state sent to the Gateway. */
export function buildGatewayState({
  goal,
  app,
  criteria,
  context = "",
  recentActions = [],
  constraints = "",
}) {
  return JSON.stringify({
    goal: String(goal ?? ""),
    app: String(app ?? ""),
    context: String(context ?? "").slice(0, 1_500),
    candidates: Object.entries(criteria ?? {}).map(([id, desc]) => ({ id, desc })),
    recent_actions: Array.isArray(recentActions) ? recentActions.slice(-6) : [],
    constraints: String(constraints ?? ""),
  });
}

function validateGatewayAnswers(raw) {
  if (!isRecord(raw) || !isRecord(raw.answers)) {
    throw new Error("Jev Gateway response has no answers");
  }

  for (const id of REQUIRED_QUESTIONS) {
    const answer = raw.answers[id];
    if (!isRecord(answer)) {
      throw new Error(`Jev Gateway response is missing answer: ${id}`);
    }
  }

  const target = raw.answers.target;
  const action = raw.answers.action;
  if (target.type !== undefined && target.type !== "choice") {
    throw new Error("Jev Gateway response has invalid target answer type");
  }
  if (action.type !== undefined && action.type !== "choice") {
    throw new Error("Jev Gateway response has invalid action answer type");
  }
  if (typeof target.choice !== "string" || typeof action.choice !== "string") {
    throw new Error("Jev Gateway response has incomplete choice answers");
  }

  for (const id of ["done", "risk"]) {
    const answer = raw.answers[id];
    if (answer.type !== undefined && answer.type !== "boolean") {
      throw new Error(`Jev Gateway response has invalid ${id} answer type`);
    }
    const probability = answer.probability ?? answer.noul;
    assertProbability(probability, `${id} probability`);
  }
}

function providerConfidence(raw, questionId) {
  const candidates = [
    raw?.answers?.[questionId]?.confidence,
    raw?.providerMetadata?.typesafe?.confidence?.[questionId],
    raw?.providerMetadata?.typesafe?.answers?.[questionId]?.confidence,
    raw?.answers?.[questionId]?.probabilities?.[raw?.answers?.[questionId]?.choice],
  ];
  for (const value of candidates) {
    const confidence = toProbability(value);
    if (confidence !== null) return confidence;
  }
  return null;
}

function normalizeGatewayAnswers(raw) {
  const answers = {
    ...raw.answers,
    target: { ...raw.answers.target },
  };
  const confidence = providerConfidence(raw, "target");
  if (confidence !== null) answers.target.confidence = confidence;
  return answers;
}

async function readGatewayJson(response) {
  if (!response || typeof response.json !== "function") {
    throw new Error("Jev Gateway response is not JSON-capable");
  }
  try {
    return await response.json();
  } catch (cause) {
    throw gatewayError("Jev Gateway returned invalid JSON", { cause });
  }
}

/**
 * Make one Jev decision through Vercel AI Gateway.
 *
 * The returned object intentionally matches `decide()` from jev-decide.mjs,
 * including the normalized target/action/done/risk fields.
 */
export async function gatewayDecide({
  goal,
  app,
  candidates = [],
  context = "",
  recentActions = [],
  constraints = "",
  apiKey,
  envFile = path.join(PROJECT_DIR, ".env.local"),
  endpoint = DEFAULT_GATEWAY_ENDPOINT,
  timeoutMs = DEFAULT_GATEWAY_TIMEOUT_MS,
  providerOptions = {},
  fetchImpl = globalThis.fetch,
}) {
  const key = String(apiKey ?? loadApiKey({ envVar: "AI_GATEWAY_API_KEY", envFile })).trim();
  if (!key) throw new Error("AI_GATEWAY_API_KEY is empty");
  if (typeof fetchImpl !== "function") throw new Error("Jev Gateway fetch is unavailable");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Jev Gateway timeoutMs must be positive");

  const { criteria, questions } = buildQuestions(goal, candidates);
  const body = {
    state: buildGatewayState({ goal, app, criteria, context, recentActions, constraints }),
    questions: toGatewayQuestions(questions),
    providerOptions,
  };

  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(gatewayError(`Jev Gateway request timed out after ${timeoutMs}ms`, { code: "ETIMEDOUT" }));
    }, timeoutMs);
  });
  const started = Date.now();

  try {
    let response;
    try {
      const request = Promise.resolve().then(() => fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "ai-model-id": GATEWAY_MODEL,
          "ai-evaluation-model-specification-version": GATEWAY_SPECIFICATION_VERSION,
          "ai-gateway-auth-method": "api-key",
          "ai-gateway-protocol-version": GATEWAY_PROTOCOL_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }));
      response = await Promise.race([request, timeoutPromise]);
    } catch (cause) {
      if (timedOut) throw gatewayError(`Jev Gateway request timed out after ${timeoutMs}ms`, { code: "ETIMEDOUT", cause });
      throw gatewayError("Jev Gateway request failed", { cause });
    }

    if (!response?.ok) {
      throw gatewayError(`Jev Gateway HTTP ${response?.status ?? "unknown"}`, { status: response?.status });
    }

    const raw = await Promise.race([readGatewayJson(response), timeoutPromise]);
    validateGatewayAnswers(raw);
    const answers = normalizeGatewayAnswers(raw);
    const decision = normalizeDecision(answers, criteria);
    return {
      ...decision,
      usage: raw.usage ?? {},
      latencyMs: Date.now() - started,
      model: GATEWAY_MODEL,
      provider: "vercel-ai-gateway",
      raw,
    };
  } catch (error) {
    if (timedOut) {
      if (error?.code === "ETIMEDOUT") throw error;
      throw gatewayError(`Jev Gateway request timed out after ${timeoutMs}ms`, { code: "ETIMEDOUT", cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
