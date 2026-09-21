# MCP 与 Computer Use 运行参考

Jev MCP 与 Computer Use 是两套独立工具。Computer Use 调用负责观察和动作；结束该调用后，再由 Codex 调用 Jev MCP。不要尝试在 `cua_repl` JavaScript 里调用 MCP。

## 1. 检查配置

先调用 `jev_status`，输入为空：

```json
{}
```

若返回 `not_configured`，先说明将出现原生隐藏输入框。用户明确同意后调用 `jev_configure`，输入仍为空。密钥不应出现在 MCP 参数、结果或聊天中。

## 2. 读取当前界面

首次 Computer Use 调用只选择 App，并阅读返回的工具文档：

```js
let app = await cua.getApp("Calendar");
```

后续 Computer Use 调用读取完整 AX：

```js
let ax = await app.getAXState({ emit: false, disableDiffing: true });
nodeRepl.write(ax);
```

Codex 从返回内容中保留任务相关的控件行和必要状态。不要把截图交给 Jev。

## 3. 生成候选

在 Computer Use 调用之外调用 `jev_candidates`：

```json
{
  "accessibility_text": "Window: \"Calendar\", App: Calendar.\n56 button previous month\n58 button next month\n59 text Value: September 2026",
  "goal": "Switch to the previous month",
  "max_candidates": 40
}
```

示例结果：

```json
{
  "candidates": [
    { "id": "i56", "index": 56, "role": "button", "label": "previous month" },
    { "id": "i58", "index": 58, "role": "button", "label": "next month" }
  ],
  "context": "Window: \"Calendar\", App: Calendar.\n59 text Value: September 2026",
  "diagnostics": {
    "clipped": false,
    "totalElements": 3,
    "totalClickable": 2,
    "unknownRoles": []
  }
}
```

中文 AX 标签会保留中文文字，但 `role` 会规范成稳定英文值，例如 `单选按钮` → `radio button`。

## 4. 获取一步决策

把上一步结果原样传给 `jev_decide`：

```json
{
  "goal": "Switch to the previous month",
  "app": "Calendar",
  "candidates": [
    { "id": "i56", "index": 56, "role": "button", "label": "previous month" },
    { "id": "i58", "index": 58, "role": "button", "label": "next month" }
  ],
  "context": "September 2026",
  "recent_actions": [],
  "constraints": "Do not create or edit events"
}
```

只有 `policy.verdict` 为 `proceed` 才能执行。`target_index` 必须与当前候选匹配。

## 5. 执行一个动作并核验

回到 Computer Use，执行恰好一个动作：

```js
await app.click(56);
```

然后在新的 Computer Use 调用中重新读取完整 AX。成功判据应比较动作前后的月份标题，而不是只检查按钮存在。若未成功，重新生成候选；不要复用索引 56。

## 6. 记录最近动作

下一次 `jev_decide` 的 `recent_actions` 最多传 6 条必要摘要，例如：

```json
[
  "click_element i56 -> month title changed from September 2026 to August 2026"
]
```

不要传密钥、完整页面正文或原始服务响应。
