const ROLE_ALIASES = Object.freeze({
  "menu bar main-menu-bar": "menu bar",
  "菜单栏 main-menu-bar": "menu bar",
  "standard window": "window",
  "标准窗口": "window",
  "full screen button": "full screen button",
  "全屏按钮": "full screen button",
  "minimize button": "minimize button",
  "最小化按钮": "minimize button",
  "close button": "close button",
  "关闭按钮": "close button",
  "radio button": "radio button",
  "单选按钮": "radio button",
  "search field": "search field",
  "搜索栏": "search field",
  "搜索文本栏": "search field",
  "text field": "text field",
  "文本栏": "text field",
  "pop up button": "pop up button",
  "弹出式按钮": "pop up button",
  "menu button": "pop up button",
  "菜单按钮": "pop up button",
  "toggle button": "toggle button",
  "切换按钮": "toggle button",
  "menu item": "menu item",
  "菜单项": "menu item",
  "date time area": "date time area",
  "日期时间区域": "date time area",
  "scroll area": "scroll area",
  "滚动区域": "scroll area",
  "split group": "split group",
  "拆分组": "split group",
  "content list": "content list",
  "内容列表": "content list",
  "check box": "checkbox",
  "checkbox": "checkbox",
  "复选框": "checkbox",
  "combo box": "combo box",
  "组合框": "combo box",
  "HTML content": "html content",
  "button": "button",
  "按钮": "button",
  "link": "link",
  "链接": "link",
  "list": "list",
  "列表": "list",
  "tab": "tab",
  "标签页": "tab",
  "toolbar": "toolbar",
  "工具栏": "toolbar",
  "menu bar": "menu bar",
  "菜单栏": "menu bar",
  "stepper": "stepper",
  "步进器": "stepper",
  "heading": "heading",
  "标题": "heading",
  "image": "image",
  "图像": "image",
  "text": "text",
  "静态文本": "text",
  "grid": "grid",
  "网格": "grid",
  "row": "row",
  "行": "row",
  "container": "container",
  "容器": "container",
  "Event": "event",
  "事件": "event",
});

const SORTED_ALIASES = Object.entries(ROLE_ALIASES).sort(
  ([left], [right]) => right.length - left.length,
);

const CANONICAL_ROLES = new Set(Object.values(ROLE_ALIASES));

const CLICKABLE_ROLES = new Set([
  "button",
  "radio button",
  "close button",
  "minimize button",
  "full screen button",
  "link",
  "menu item",
  "text field",
  "search field",
  "checkbox",
  "pop up button",
  "toggle button",
  "stepper",
  "combo box",
  "tab",
  "list",
  "date time area",
]);

function matchRole(rest) {
  const found = SORTED_ALIASES.find(([alias]) => rest === alias || rest.startsWith(`${alias} `));
  if (found) return { source: found[0], canonical: found[1] };
  const source = rest.split(/\s+/, 1)[0] ?? "";
  return { source, canonical: source };
}

export function parseAccessibilitySnapshot(text) {
  const elements = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(/^(\s*)(\d+)\s+(.*)$/);
    if (!match) continue;
    const rest = match[3].trim();
    const role = matchRole(rest);
    const label = rest
      .slice(role.source.length)
      .trim()
      .replace(/,?\s*Secondary Actions:.*$/i, "")
      .trim();
    elements.push({
      index: Number(match[2]),
      role: role.canonical,
      label,
      depth: match[1].replace(/\t/g, "    ").length,
    });
  }
  return elements;
}

export function sanitizeLabel(text, maxLength = 120) {
  return String(text ?? "")
    .replace(/\b(?:https?|orpheus|file|javascript|data):\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function scoreCandidate(element, goalTokens, goal) {
  let score = 0;
  if (["button", "toggle button", "radio button", "menu item", "pop up button", "combo box"].includes(element.role)) {
    score += 3;
  }
  if (["text field", "search field"].includes(element.role)) score += 2;
  if (element.role === "link") score += 1;

  const label = element.label.toLowerCase();
  for (const token of goalTokens) {
    if (label.includes(token)) score += 4;
  }
  if (!label || /^javascript:;?$/.test(label)) score -= 2;
  if (/previous month|next month|today|上个月|下个月|今天|搜索|search/i.test(label)
      && /month|月|搜索|search/i.test(goal)) {
    score += 6;
  }
  if (element.role === "toggle button" && /toolbar|tool\b|工具栏/i.test(goal)) score += 5;
  return score;
}

function buildContext(text, maxTextLines = 6) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const head = lines.slice(0, 2);
  const visibleText = lines
    .filter((line) => /^\d+\s+(?:text|静态文本)\b/i.test(line))
    .slice(0, maxTextLines);
  const focus = lines.find((line) => /focused UI element|当前聚焦的 UI 元素/i.test(line));
  return [...head, ...visibleText, focus].filter(Boolean).join("\n").slice(0, 1_500);
}

export function collectCandidates(text, goal = "", { max = 40, maxTextLines = 6 } = {}) {
  const elements = parseAccessibilitySnapshot(text);
  const goalText = String(goal).toLowerCase();
  const goalTokens = goalText
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => token.length >= 2);
  const maximum = Math.min(80, Math.max(1, Number.isFinite(max) ? Math.floor(max) : 40));

  const ranked = elements
    .filter((element) => CLICKABLE_ROLES.has(element.role))
    .map((element) => ({
      ...element,
      label: sanitizeLabel(element.label),
      score: scoreCandidate(element, goalTokens, goalText),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const candidates = ranked.slice(0, maximum).map(({ score: _score, depth: _depth, ...element }) => ({
    id: `i${element.index}`,
    ...element,
  }));
  const unknownRoles = [...new Set(
    elements
      .map((element) => element.role)
      .filter((role) => role && !CANONICAL_ROLES.has(role)),
  )];

  return {
    candidates,
    context: buildContext(text, maxTextLines),
    diagnostics: {
      clipped: ranked.length > maximum,
      totalElements: elements.length,
      totalClickable: ranked.length,
      unknownRoles,
    },
  };
}
