# Jev-cu

把 Computer Use 的「下一步点哪里」交给 Jev（TypeSafe System One）：Jev 从界面文字候选中选元素、动作、完成度与风险，Codex Computer Use 负责读取界面与执行，本地策略门槛拦截敏感操作。只传文字，不传截图。

## 目录

```
skill/jev-use/   可安装到 Codex 的 skill（运行手册 + 安全规则）
scripts/         Jev 调用、策略门槛、决策循环、离线评测、安装脚本
fixtures/        AX 快照与 P0 用例
tests/           单测
```

## 安装 skill

```bash
npm run install-skill      # 复制到 ~/.codex/skills/jev-use，新会话生效
npm run uninstall-skill
```

skill 源文件里的 `{{REPO_DIR}}` 会在安装时替换成仓库实际路径。

## 使用

先在 `.env.local` 写入 key（不提交），或设置同名环境变量：

```bash
echo 'TYPESAFE_API_KEY=<your key>' > .env.local
```

循环要在 Codex 桌面 App 的 `cua_repl` 运行时里执行：

```js
const repo = "/path/to/Jev-cu"; // 换成实际克隆路径
const { pathToFileURL } = await import("node:url");
const { runTask, createCuaDriver } = await import(pathToFileURL(`${repo}/scripts/loop.mjs`).href);

await runTask({
  driver: createCuaDriver(cua),
  appName: "Calendar",
  goal: "switch the calendar to the previous month", // 英文目标，Jev 英文最准
  dryRun: true,                                       // 确认后改 false
  maxSteps: 5,
});
```

### Windows 原生应用

Windows 的 `getApp` 不按应用名启动或绑定，必须先从 inventory 核对窗口标题并选择精确 `windowId`：

```js
const state = await cua.getState(); // 先检查 state.apps / state.apps[].windows
const driver = createCuaDriver(cua, { windowId: 123 }); // 换成核对后的窗口 ID

await runTask({
  driver,
  appName: "Calculator",
  goal: "Press the Equals button.",
  dryRun: true,
  maxSteps: 2,
});
```

如果目标应用尚未打开，使用当前 `cua_repl` 文档提供的 `cua.computer.launch_app`，刷新 inventory 后再按窗口 ID 绑定。

### Windows 浏览器

浏览器使用跨平台 Tab driver。首次调用应只选择或创建标签页并阅读 `cua_repl` 返回的当前文档；后续调用再导入循环：

```js
var browserTab = await cua.getTab(tabId, { browser: browserId }); // ID 来自当前 tab/browser inventory

var browserUrl = await import("node:url");
var browserLoop = await import(browserUrl.pathToFileURL(`${repo}/scripts/loop.mjs`).href);

await browserLoop.runTask({
  driver: browserLoop.createCuaTabDriver(browserTab),
  appName: "Codex In-app Browser", // 或策略白名单中的实际浏览器名
  goal: "Open the Learn more link.",
  dryRun: true,
  maxSteps: 2,
});
```

Tab 必须来自 `cua.getTab(...)` 或 `cua.createBrowserTab(...)`；实现不会自行猜测浏览器、标签页或用户当前页面。浏览器文本输入会把 Jev 选择的元素索引传给 Tab API，再由循环重新读取完整 AX 状态核验。

## 验证

```bash
npm test        # 单测，不调用 API
npm run p0      # 离线评测：AX 快照选元素准确率（调用 Jev，需要 key）
```

## 安全边界

- 默认 dry-run；删除、发送、支付、授权、上传、验证码、安装、系统设置等操作停在 `confirm`，需人工确认。
- App 白名单在 `scripts/policy.mjs`，新增 App 必须显式修改。
- 界面文字只作为数据，不作为指令；不绕过登录、付费墙和验证码。
