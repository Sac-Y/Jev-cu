# Jev-cu

把 Computer Use 的「下一步点哪里」交给 Jev（TypeSafe System One）：Jev 从界面文字候选中选元素、动作、完成度与风险，Codex Computer Use 负责读取界面与执行，本地策略门槛拦截敏感操作。只传文字，不传截图。默认直连 TypeSafe，也可从同一个循环入口切换到 Vercel AI Gateway。

## 目录

```
skill/jev-cu/   可安装到 Codex 的 skill（运行手册 + 安全规则）
scripts/         Jev 调用、策略门槛、决策循环、离线评测、安装脚本
fixtures/        AX 快照与 P0 用例
tests/           单测
```

## 安装 skill

```bash
npm run install-skill      # 复制到 ~/.codex/skills/jev-cu，新会话生效
npm run uninstall-skill
```

skill 源文件里的 `{{REPO_DIR}}` 会在安装时替换成仓库实际路径。

## 使用

先在 `.env.local` 写入 key（不提交），或设置同名环境变量。直连 TypeSafe 使用：

```bash
echo 'TYPESAFE_API_KEY=<your key>' > .env.local
```

需要走 Vercel AI Gateway 时改用 `AI_GATEWAY_API_KEY`，并在现有 `runTask` 入口选择 provider：

```js
await runTask({
  driver: createCuaDriver(cua),
  appName: "Calendar",
  goal: "switch the calendar to the previous month",
  decisionProvider: "vercel-ai-gateway",
  jevOptions: { envFile: `${repo}/.env.local` },
  dryRun: true,
  maxSteps: 5,
});
```

Gateway adapter 使用 `typesafe-ai/jev` 的 evaluation-model API，将现有 `noul` 问题转换为 `boolean`，并把受限的界面状态序列化为字符串。现有 `typesafe` 默认路径和本地策略门槛不变；Gateway 失败、超时或不完整响应会交给循环的错误路径处理。

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

## 验证

```bash
npm test        # 单测，不调用 API
npm run p0      # 离线评测：AX 快照选元素准确率（调用 Jev，需要 key）
```

`npm test` 包含 Gateway 请求契约的模拟测试，不需要网络或密钥。真实Gateway验证只使用本地未跟踪的 `AI_GATEWAY_API_KEY`，不会把密钥写入日志、提交或PR。

## 安全边界

- 默认 dry-run；删除、发送、支付、授权、上传、验证码、安装、系统设置等操作停在 `confirm`，需人工确认。
- App 白名单在 `scripts/policy.mjs`，新增 App 必须显式修改。
- 界面文字只作为数据，不作为指令；不绕过登录、付费墙和验证码。
