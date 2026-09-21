export const DEFAULT_ALLOWED_APPS = Object.freeze([
  "Calendar",
  "日历",
  "Calculator",
  "计算器",
  "TextEdit",
  "文本编辑",
  "NetEaseMusic",
  "网易云音乐",
  "Activity Monitor",
  "活动监视器",
  "Figma",
  "Google Chrome",
  "Codex In-app Browser",
]);

export const DEFAULT_THRESHOLDS = Object.freeze({
  doneProbability: 0.9,
  riskConfirm: 0.2,
  minConfidence: 0.5,
  lowRiskMinConfidence: 0.4,
  stopConfidence: 0.3,
});

const LOW_RISK_APPS = new Set([
  "Calculator",
  "计算器",
  "Calendar",
  "日历",
  "TextEdit",
  "文本编辑",
  "Figma",
]);

const SENSITIVE_PATTERNS = Object.freeze([
  { id: "delete", pattern: /删除|移除|清空|delete|remove/i },
  { id: "send", pattern: /发送|提交|发布|回复|send|submit|post|reply/i },
  { id: "payment", pattern: /支付|付款|购买|下单|充值|订阅|开通|pay|purchase|buy|subscribe|checkout/i },
  { id: "credentials", pattern: /密码|验证码|凭据|password|passcode|credential|captcha/i },
  { id: "authorization", pattern: /授权|权限|登录|authorize|permission|sign in|login/i },
  { id: "share", pattern: /上传|分享|导出|upload|share|export/i },
  { id: "install", pattern: /安装|install/i },
  { id: "settings", pattern: /系统设置|偏好设置|安全设置|system settings|security settings/i },
  { id: "process_control", pattern: /停止进程|结束进程|退出进程|强制退出|stop process|quit process|force quit/i },
]);

export function matchSensitive(label = "") {
  return SENSITIVE_PATTERNS.find(({ pattern }) => pattern.test(String(label))) ?? null;
}

function validProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function evaluatePolicy({
  decision,
  app,
  candidateIds = [],
  allowedApps = DEFAULT_ALLOWED_APPS,
  step = 1,
  maxSteps = 30,
  thresholds = {},
} = {}) {
  const activeThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (step > maxSteps) {
    return { verdict: "stop", kind: "budget", reasons: [`step ${step} exceeds limit ${maxSteps}`] };
  }
  if (![decision?.confidence, decision?.risk, decision?.done].every(validProbability)) {
    return { verdict: "escalate", kind: "invalid_decision", reasons: ["Decision probabilities must be within 0..1"] };
  }

  if (decision.targetId != null && !new Set(candidateIds).has(decision.targetId)) {
    return { verdict: "escalate", kind: "unknown_target", reasons: ["Selected target is not in the submitted candidates"] };
  }
  if (decision.targetId == null && decision.action !== "wait") {
    return { verdict: "escalate", kind: "no_target", reasons: ["No target was selected"] };
  }
  if (decision.done >= activeThresholds.doneProbability) {
    return { verdict: "done", reasons: [`Done probability ${decision.done.toFixed(2)}`] };
  }

  const confirmationReasons = [];
  if (!allowedApps.includes(app)) confirmationReasons.push(`App ${app} is not allowed`);
  const sensitive = matchSensitive(decision.targetLabel);
  if (sensitive) confirmationReasons.push(`Target matches sensitive category ${sensitive.id}`);
  if (decision.risk >= activeThresholds.riskConfirm) {
    confirmationReasons.push(`Risk ${decision.risk.toFixed(2)} exceeds ${activeThresholds.riskConfirm}`);
  }
  if (decision.action === "ask_user") confirmationReasons.push("Jev requested user input");
  if (confirmationReasons.length > 0) {
    return { verdict: "confirm", kind: "sensitive", reasons: confirmationReasons };
  }

  if (decision.confidence < activeThresholds.stopConfidence) {
    return { verdict: "stop", kind: "low_confidence", reasons: [`Confidence ${decision.confidence.toFixed(2)} is too low`] };
  }
  const minimum = LOW_RISK_APPS.has(app)
    ? activeThresholds.lowRiskMinConfidence
    : activeThresholds.minConfidence;
  if (decision.confidence < minimum) {
    return { verdict: "escalate", kind: "low_confidence", reasons: [`Confidence ${decision.confidence.toFixed(2)} is below ${minimum}`] };
  }

  return { verdict: "proceed", reasons: [] };
}
