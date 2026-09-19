# 运行示例

以下代码只在 `cua_repl` 中使用。首次调用只执行一个入口调用并阅读返回的工具文档：macOS App 可用 `await cua.getApp("Calendar")`；Windows/Linux App 先用 `await cua.getState()` 核对精确窗口 ID；浏览器先用 `await cua.getTab(...)` 或 `await cua.createBrowserTab(...)` 绑定标签页。导入及循环放到后续调用。若当前接口与 driver 不匹配，停止并适配，不猜测 API。

```js
var jevUrl = await import("node:url");
var repoDir = String.raw`{{REPO_DIR}}`; // String.raw 保留 Windows 路径反斜杠
var jevLoop = await import(jevUrl.pathToFileURL(
  repoDir + "/scripts/loop.mjs"
).href);

// 先从当前 AX 确认实际使用的角色、标签、ID 和选中状态。
// 此判据适用于已观测到 week-button / Value: 1 的 Calendar 界面。
var weekSelected = ax => ax.split("\n").some(line =>
  /radio button/.test(line) && /ID: week-button\b/.test(line) && /Value: 1\b/.test(line)
);
var jevResult = await jevLoop.runTask({
  driver: jevLoop.createCuaDriver(cua),
  appName: "Calendar",
  goal: "Switch Calendar to Week view.",
  dryRun: true,
  maxSteps: 2,
  verify: weekSelected,
});
nodeRepl.write(jevResult);
```

预览通过且动作已授权后，才改 `dryRun: false`。若一开始已是周视图，核验可以直接完成，不应为展示而重复点击。

- `verify(ax)`：纯读取的总目标判据。每步之前和最后一步之后检查；不能只匹配按钮存在，要匹配选中状态或结果值。
- `resources: { text, key, direction }`：Codex 提供的动作参数。需要动态参数时可使用无副作用回调；每步可能调用两次（决策前参数为 `null`，决策后为 decision）。
- 不混用不同 `jevGoal` 来编排多阶段长任务：每个阶段单独调用并核验，再进入下一阶段。
- 默认候选上限 40；扩大前检查是否是角色过滤或标签问题。
- `cua_repl` 默认超时 30 秒，调用时长必须覆盖 API 和观测耗时；演示建议单阶段至多 2–3 步，工具超时可设为 60 秒。外层超时后先检查状态和轨迹，不能假设动作未发生。
- `plan` 是提示，不是持久化执行进度。静态动作计划和 `skipJev` 不能用作 Jev 决策表现的证据。

当前策略仍有按 App 放宽门槛和关键词误判的限制；不要把白名单或低风险分类理解为对该 App 所有写操作的授权。复杂输入与坐标拖拽需独立验证。

## Windows 与浏览器 driver

Windows 原生应用从 inventory 选择精确窗口后绑定：

```js
var state = await cua.getState(); // 核对 state.apps[].windows 的标题和 id
var driver = jevLoop.createCuaDriver(cua, { windowId: 123 });
```

浏览器直接复用已经核对的 Tab，Windows/macOS/Linux 调用方式相同：

```js
var browserTab = await cua.getTab(tabId, { browser: browserId });
var driver = jevLoop.createCuaTabDriver(browserTab);
```

把 `driver` 传给 `runTask`。浏览器 `type_text` 和 `press_key` 会使用 Jev 当前选择的元素索引；每次动作后仍重新读取 AX，不能复用旧索引。
