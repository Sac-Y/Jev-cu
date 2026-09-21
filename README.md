# Jev-cu

把 Computer Use 的「下一步点哪里」交给 Jev（TypeSafe System One）：Jev 从界面文字候选中选元素、动作、完成度与风险，Codex Computer Use 负责读取界面与执行，本地策略门槛拦截敏感操作。只传文字，不传截图。

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

## 可选的 Jev 路由与规划器接管

默认仍是原有四问。设置 `routing: true` 后，在同一次 Jev 请求中增加一个独立
`route` 问题，不为普通动作额外增加一次网络往返：

- `execute`：文字观察和准备好的输入足以支持当前动作，继续经过原有策略门槛。
- `reobserve`：重新读取完整状态后再判断；默认最多一次。
- `reasoning` / `vision`：把子目标交回调用方的复杂推理或视觉规划器，不执行本次动作答案。

```js
const result = await runTask({
  driver: createCuaDriver(cua),
  appName: "Calendar",
  goal: "Switch Calendar to the previous month",
  dryRun: false, // 先完成 dry-run 并确认该动作在授权范围内
  maxSteps: 5,
  routing: true,
  // 可选；planner 是调用方配置的模型适配器，不由 Jev-cu 安装或选取。
  onHandoff: async (request, { signal }) => planner.plan({
    goal: request.subgoal,
    context: request.context, // 由调用方先确认可发送的数据；不要无条件转发完整对象
    reason: request.reason,
    signal,
  }),
});
```

没有 `onHandoff` 时返回 `status: "handoff"`，由当前 Codex/其他宿主处理。
回调最多调用一次，结果只在 `plannerResult` 中返回，**不会自动执行或自动续跑**。
宿主应审核新的子目标和参数，重新观察、重新构造候选后再调用 `runTask`，并维护跨调用的
总预算。`dryRun` 不调用规划器。回调需遵守 `AbortSignal`；超时返回
`plannerStatus: "timeout"`，宿主不得把未取消的晚到结果用于执行。

`routing` 也可以传配置对象：

```js
routing: {
  minConfidence: 0.5,
  maxReobservations: 1,
  maxNoProgress: 2,
  handoffTimeoutMs: 30_000,
  requirePlanner: null, // 已知必须看图/复杂推理时填 "vision" 或 "reasoning"，不先询问 Jev
}
```

启用后，缺少候选、缺失/非法/低置信度路由、观察预算耗尽，以及连续两次动作后 AX 文本
完全不变，会独立触发接管；即使 Jev 对动作很自信也一样。AX 文本改变不证明任务有进展，
文字不变也不证明画布没有改变；仍应提供任务级 `verify`，能力不匹配时请求视觉接管。
权限确认、提供方错误和结果不明的执行错误保留原有停止行为，不自动换模型重试。

`handoff` 包含总目标、当前子目标、有限上下文和最近六条动作摘要，不含截图、driver 对象、
输入资源或可重放的候选参数。轨迹记录接管原因和回调状态，不记录规划器返回的内容。
上下文本身仍可能含私人文字；调用方负责筛选可发送数据和提供方授权。

此功能不是已经验证的通用难度识别器。置信度阈值只是默认策略，需要在目标任务上评估
错误自处理、过度接管、模型调用次数及完成任务的延迟；增加一个问题仍有 token 成本。

### 本地或其他兼容决策模型

路由循环不绑定 TypeSafe SDK。默认 `decide` 仍使用本项目的 Jev API；也可通过原有的
`decide` 注入接口接入本地部署的模型或其他适配器，不需要为该路径设置 TypeSafe 密钥。
适配器接收 `goal / app / context / candidates / recentActions / constraints / routing`，
在 `routing: true` 时返回 `route`（四个值之一）及 `routeConfidence`（0–1）。
选择 `execute` 时，还必须返回原有的动作、目标和策略字段：

```js
await runTask({
  driver: createCuaDriver(cua), appName: "Calendar", goal: "Previous month",
  routing: true,
  decide: localChooser, // 调用方适配本地 HTTP/进程/SDK；也可以在同一次推理中联合选择动作
});
// localChooser 的 execute 输出示例（索引必须来自本次 candidates）：
// { route: "execute", routeConfidence: 0.9, action: "click_element",
//   targetIndex: 56, targetLabel: "previous month", confidence: 0.9, risk: 0, done: 0 }
```

这是结构化适配接口，不是任意模型的即插即用保证。不同模型的置信度不能直接等同，
应分别校准策略并报告无法提供可靠路由的情况。仅支持路由的模型也可以由调用方适配器
与动作模型组合，但需单独统计新增调用与延迟。路由关闭时不要调用额外路由模型。

## 验证

```bash
npm test        # 单测，不调用 API
npm run p0      # 离线评测：AX 快照选元素准确率（调用 Jev，需要 key）
```

## 安全边界

- 默认 dry-run；删除、发送、支付、授权、上传、验证码、安装、系统设置等操作停在 `confirm`，需人工确认。
- App 白名单在 `scripts/policy.mjs`，新增 App 必须显式修改。
- 界面文字只作为数据，不作为指令；不绕过登录、付费墙和验证码。
