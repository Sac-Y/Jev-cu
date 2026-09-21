import path from "node:path";

import { collectCandidates } from "./candidates.mjs";
import { createCredentialStore } from "./credentials.mjs";
import { requestDecision as requestJevDecision } from "./jev-client.mjs";
import { evaluatePolicy } from "./policy.mjs";

export class HandlerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HandlerError";
    this.code = code;
  }
}

function requireString(value, name, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new HandlerError("invalid_input", `${name} must be a string of at most ${maximum} characters`);
  }
  return value;
}

function requireMac(platform) {
  if (platform !== "darwin") {
    throw new HandlerError("unsupported_platform", "Jev-cu currently supports macOS only");
  }
}

function validateCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 80) {
    throw new HandlerError("invalid_input", "candidates must contain between 1 and 80 items");
  }
  const ids = new Set();
  return candidates.map((candidate) => {
    const index = candidate?.index;
    const id = candidate?.id;
    if (!Number.isSafeInteger(index) || index < 0 || id !== `i${index}` || ids.has(id)) {
      throw new HandlerError("invalid_input", "candidate ids must be unique and match their non-negative index");
    }
    ids.add(id);
    return {
      id,
      index,
      role: requireString(candidate.role, "candidate role", 80),
      label: requireString(candidate.label, "candidate label", 120, { allowEmpty: true }),
    };
  });
}

export function createToolHandlers({
  platform = process.platform,
  credentials = createCredentialStore(),
  requestDecision = requestJevDecision,
} = {}) {
  return {
    async status() {
      if (platform !== "darwin") {
        return {
          platform,
          configured: false,
          ready: false,
          code: "unsupported_platform",
        };
      }
      const { configured } = await credentials.status();
      return {
        platform,
        configured,
        ready: configured,
        code: configured ? "ready" : "not_configured",
      };
    },

    async configure(input = {}) {
      requireMac(platform);
      if (input.source_file === undefined) {
        return {
          status: "source_file_required",
          configured: false,
          ready: false,
          credential_path: credentials.path,
        };
      }
      const sourcePath = requireString(input.source_file, "source_file", 4_096);
      if (!path.isAbsolute(sourcePath)) {
        throw new HandlerError("invalid_input", "source_file must be an absolute path");
      }
      await credentials.importFromEnv(sourcePath);
      return {
        status: "saved",
        configured: true,
        ready: true,
      };
    },

    async candidates(input = {}) {
      requireMac(platform);
      const accessibilityText = requireString(input.accessibility_text, "accessibility_text", 50_000);
      const goal = requireString(input.goal, "goal", 500);
      const maximum = input.max_candidates ?? 40;
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 80) {
        throw new HandlerError("invalid_input", "max_candidates must be an integer between 1 and 80");
      }
      return collectCandidates(accessibilityText, goal, { max: maximum });
    },

    async decide(input = {}) {
      requireMac(platform);
      const goal = requireString(input.goal, "goal", 500);
      const app = requireString(input.app, "app", 200);
      const candidates = validateCandidates(input.candidates);
      const context = requireString(input.context ?? "", "context", 1_500, { allowEmpty: true });
      const constraints = requireString(input.constraints ?? "", "constraints", 1_500, { allowEmpty: true });
      const recentActions = input.recent_actions ?? [];
      if (!Array.isArray(recentActions) || recentActions.length > 6
          || recentActions.some((item) => typeof item !== "string" || item.length > 300)) {
        throw new HandlerError("invalid_input", "recent_actions must contain at most 6 strings of at most 300 characters");
      }

      let apiKey;
      try {
        apiKey = await credentials.read();
      } catch (error) {
        if (error?.code === "not_configured") return { ready: false, code: "not_configured" };
        throw error;
      }

      const rawDecision = await requestDecision({
        goal,
        app,
        candidates,
        context,
        recentActions,
        constraints,
      }, { apiKey });
      const selected = candidates.find((candidate) => candidate.id === rawDecision.targetId);
      const decision = {
        action: rawDecision.action,
        target_id: rawDecision.targetId ?? null,
        target_index: selected?.index ?? rawDecision.targetIndex ?? null,
        target_label: selected ? `${selected.role}: ${selected.label}` : null,
        confidence: rawDecision.confidence,
        risk: rawDecision.risk,
        done: rawDecision.done,
      };
      const policyDecision = {
        action: decision.action,
        targetId: decision.target_id,
        targetIndex: decision.target_index,
        targetLabel: decision.target_label,
        confidence: decision.confidence,
        risk: decision.risk,
        done: decision.done,
      };
      const policy = evaluatePolicy({
        decision: policyDecision,
        app,
        candidateIds: candidates.map((candidate) => candidate.id),
      });

      return {
        ready: true,
        decision,
        policy,
        usage: {
          model: rawDecision.model,
          latency_ms: rawDecision.latencyMs,
          input_tokens: rawDecision.usage?.inputTokens ?? 0,
          estimated_cost_usd: rawDecision.costUsd ?? 0,
        },
      };
    },
  };
}
