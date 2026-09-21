# Jev-cu

Jev-cu 把 macOS 界面中的候选控件交给 Jev（TypeSafe System One）选择，再由 Codex Computer Use 执行一个动作并重新核验。Jev 只接收有界文字候选，不接收截图；本地策略会拦截敏感、越界或低置信度的建议。

## 安装到 Codex

要求 macOS、Node.js 20 或更高版本，以及支持插件和 Computer Use 的 Codex Desktop。

```bash
codex plugin marketplace add rainhan99/Jev-cu
codex plugin add jev-cu@jev-cu-community
```

安装后新建一个 Codex 任务，使 skill 与 MCP 工具重新加载。调用 `$jev-use`；首次使用时，Codex 会先检查状态，并在你明确同意后打开原生隐藏输入框采集 Jev API key。

密钥直接保存到 macOS Keychain：

- Service：`ai.typesafe.jev-cu`
- Account：`api-key`

密钥不会进入聊天、MCP 参数、插件配置、命令行参数或日志。恢复场景也可以在源码目录运行：

```bash
node plugins/jev-cu/scripts/configure-key.mjs
node plugins/jev-cu/scripts/clear-key.mjs
```

## 使用方式

在 Codex 中明确调用 `$jev-use` 并描述目标，例如：

```text
使用 $jev-use，把 Calendar 切换到上一个月；不要创建或修改日程。
```

运行流程是：

1. Computer Use 读取当前 AX 状态。
2. `jev_candidates` 规范化英文或中文角色并限制候选规模。
3. `jev_decide` 从当前候选中选择一步并运行本地安全策略。
4. 只有策略返回 `proceed`，Computer Use 才执行一个动作。
5. Codex 重新观察并用实际界面状态核验结果。

MCP 服务不控制 GUI，也不从 `cua_repl` 联网。删除、发送、支付、权限、凭据、上传分享、安装和系统设置等操作仍受宿主确认规则约束。

## 更新

```bash
codex plugin marketplace upgrade jev-cu-community
codex plugin add jev-cu@jev-cu-community
```

更新后新建 Codex 任务。如果工具列表仍是旧版本，完全退出并重新打开 Codex Desktop。

## 本地开发

```bash
npm ci --prefix plugins/jev-cu
npm test
npm run build
npm run validate
```

运行时入口是 `plugins/jev-cu/bin/jev-cu-mcp`，它只依赖已提交的 `dist/server.mjs`，因此从 marketplace 安装后不需要再次执行包管理器。

## 排障

- `not_configured`：同意后调用 `jev_configure`，或运行恢复脚本。
- `authentication_failed` / HTTP `401`、`403`：重新配置 Keychain 密钥。
- `rate_limited` / HTTP `429`：等待限流窗口恢复后重试。
- `service_unavailable` / HTTP `5xx`：服务端暂不可用；有界重试耗尽后停止。
- `network_failed`：检查普通 Node 进程的公网连接；不要改回 `cua_repl` 直接联网。
- 找不到 MCP 工具：确认插件已安装，随后新建任务；仍无效时完全重启 Codex Desktop。
- 中文界面候选为空：保留诊断中的未知角色并提交最小 AX 示例，不要翻译整棵树后继续操作。

## Claude Desktop

MCP 工具 schema 与核心模块没有 Codex API 依赖，已为 Claude Desktop STDIO 接入预留边界。本版本不写入 Claude Desktop 配置，也不提供 Claude 端的 macOS UI 驱动；后续可以复用同一决策 MCP，单独设计权限和界面控制层。

## 安全边界

- MCP 服务只读 Keychain、调用固定 TypeSafe endpoint，并返回结构化建议。
- MCP 不暴露 shell、任意 URL 抓取或通用 UI 操作工具。
- Jev 只能选择本次提交的候选 ID。
- 每次只执行一个动作，随后重新观察；旧索引一律失效。
- Jev 的完成概率不等于成功，最终结果必须由界面状态证明。
