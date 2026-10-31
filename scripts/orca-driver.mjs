import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseAX } from "./loop.mjs";

// Orca/macOS localizes role names; Jev's parser expects English roles.
// Preserve labels, indentation and sparse indexes from the current snapshot.
const ROLE_NAMES = Object.entries({
  "표준 윈도우": "standard window", "자르기 그룹": "split group",
  "스크롤 영역": "scroll area", "라디오 버튼": "radio button",
  "닫기 버튼": "close button", "최소화 버튼": "minimize button",
  "전체 화면 버튼": "full screen button", "검색 텍스트 필드": "search field",
  "검색 필드": "search field", "텍스트 필드": "text field",
  "팝업 버튼": "pop up button", "토글 버튼": "toggle button",
  "체크상자": "checkbox", "체크 상자": "checkbox", "콤보 상자": "combo box",
  "메뉴 항목": "menu item", "도구 막대": "toolbar", "메뉴 막대": "menu bar",
  "버튼": "button", "텍스트": "text", "링크": "link", "탭": "tab",
  "목록": "list", "이미지": "image", "제목": "heading",
}).sort(([a], [b]) => b.length - a.length);

export function normalizeOrcaAX(tree) {
  return tree.split("\n").map(line => {
    const match = line.match(/^(\s*\d+\s+)(.*)$/);
    if (!match) return line;
    let rest = match[2];
    for (const [local, role] of ROLE_NAMES) {
      if (rest === local || rest.startsWith(local + " ") || rest.startsWith(local + ",")) {
        rest = role + rest.slice(local.length);
        break;
      }
    }
    // Orca can place metadata immediately after a role: "checkbox, Value: 1".
    rest = rest.replace(/^([\w ]+),\s*/, "$1 ");
    return match[1] + rest;
  }).join("\n");
}

function runCLI(command, args, { input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8",
    }, (error, stdout) => {
      // Do not include command arguments, stdin, or stderr in errors.
      if (error && !stdout) return reject(new Error(`Orca CLI failed (${error.code ?? "unknown"})`));
      resolve(stdout);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

export function createOrcaDriver({
  command = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : process.platform === "linux" ? "orca-ide" : "orca"),
  appSelector, windowId, windowIndex, restoreWindow = false,
  sessionId = randomUUID(), timeoutMs = 30_000, invoke = runCLI,
} = {}) {
  if (windowId != null && windowIndex != null) throw new Error("Choose windowId or windowIndex, not both");
  let app;
  let pinnedWindowId = windowId;
  let indices = new Set();
  let observed = false;

  async function call(action, args = [], input) {
    if (!app) throw new Error("Bind an app before observing or acting");
    const scope = pinnedWindowId != null ? ["--window-id", String(pinnedWindowId)]
      : windowIndex != null ? ["--window-index", String(windowIndex)] : [];
    const argv = ["computer", action, "--app", app, "--session", sessionId, ...scope,
      ...(restoreWindow ? ["--restore-window"] : []), ...args, "--no-screenshot", "--json"];
    const stdout = await invoke(command, argv, { input, timeoutMs });
    let response;
    try { response = JSON.parse(stdout); } catch { throw new Error("Orca returned invalid JSON"); }
    if (response.ok !== true) throw new Error(`Orca ${action} failed: ${response.error?.code ?? "unknown_error"}`);
    return response.result;
  }

  function requireIndex(index) {
    if (!observed || !Number.isSafeInteger(index) || !indices.has(index)) {
      throw new Error("Target index is missing or stale; observe again before acting");
    }
    return String(index);
  }

  function pointArgs(value, x = "--x", y = "--y") {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
      throw new Error("Coordinates must be two finite window-local numbers");
    }
    return [x, String(value[0]), y, String(value[1])];
  }

  async function act(action, args, input) {
    if (!observed) throw new Error("Observe the target window before acting");
    // Even a failed/timeout action may have changed the UI. Never retry it blindly.
    observed = false;
    indices.clear();
    return call(action, args, input);
  }

  return {
    async bind(appName) {
      if (typeof (appSelector ?? appName) !== "string" || !(appSelector ?? appName).trim()) {
        throw new Error("An app selector is required");
      }
      app = appSelector ?? appName;
      pinnedWindowId = windowId;
      observed = false;
      indices.clear();
    },
    async observe() {
      observed = false;
      indices.clear();
      const result = await call("get-app-state");
      const snapshot = result?.snapshot;
      if (!snapshot || typeof snapshot.treeText !== "string" || !snapshot.treeText.trim()) {
        throw new Error("Orca returned no accessibility tree");
      }
      if (snapshot.truncation?.truncated) throw new Error("Orca accessibility tree is truncated; narrow the target window");
      if (pinnedWindowId != null && snapshot.window?.id != null && String(pinnedWindowId) !== String(snapshot.window.id)) {
        throw new Error("Orca returned a different window; bind and observe again");
      }
      if (snapshot.window?.id != null && snapshot.window.id !== "none") pinnedWindowId = snapshot.window.id;
      const ax = normalizeOrcaAX(snapshot.treeText);
      indices = new Set(parseAX(ax).map(element => element.index));
      observed = true;
      return ax;
    },
    async click(target, { mouseButton = "left" } = {}) {
      if (!["left", "right", "middle"].includes(mouseButton)) throw new Error("Invalid mouse button");
      const args = Array.isArray(target) ? pointArgs(target) : ["--element-index", requireIndex(target)];
      return act("click", [...args, "--mouse-button", mouseButton]);
    },
    async drag(from, to) {
      const source = Array.isArray(from) ? pointArgs(from, "--from-x", "--from-y") : ["--from-element-index", requireIndex(from)];
      const dest = Array.isArray(to) ? pointArgs(to, "--to-x", "--to-y") : ["--to-element-index", requireIndex(to)];
      return act("drag", [...source, ...dest]);
    },
    async setValue(index, text) {
      return act("set-value", ["--element-index", requireIndex(index), "--value-stdin"], String(text));
    },
    async typeText(text) { return act("type-text", ["--text-stdin"], String(text)); },
    async pressKey(key) {
      if (typeof key !== "string" || !key.trim()) throw new Error("A key is required");
      return act(key.includes("+") ? "hotkey" : "press-key", ["--key", key]);
    },
    async scroll(index, direction, pages = 1) {
      if (!["up", "down", "left", "right"].includes(direction) || !Number.isSafeInteger(pages) || pages < 1) {
        throw new Error("Invalid scroll direction/pages");
      }
      return act("scroll", ["--element-index", requireIndex(index), "--direction", direction, "--pages", String(pages)]);
    },
  };
}
