# Jev-cu Codex MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Jev-cu into a macOS Codex plugin that installs from the `rainhan99/Jev-cu` Git marketplace, obtains its API key through a hidden native prompt, and exposes safe Jev decisions through a local STDIO MCP server.

**Architecture:** The Git repository is a one-plugin marketplace; the plugin contains a bundled Node.js STDIO MCP server and the `jev-use` skill. Computer Use remains the only UI observer/executor, while the MCP server normalizes English or Chinese accessibility text, reads the API key from macOS Keychain, calls Jev, validates the answer, and returns a recommendation. Core modules and tool schemas remain host-neutral for a later Claude Desktop adapter.

**Tech Stack:** Node.js 20+, ECMAScript modules, `@modelcontextprotocol/sdk`, Zod, esbuild, Node's built-in test runner, macOS `/usr/bin/security`, and `/usr/bin/osascript`.

**Spec:** `docs/superpowers/specs/2026-09-21-codex-mcp-design.md`

## Global Constraints

- First release supports macOS only.
- Computer Use owns UI observation and actions; the MCP server never clicks, types into, or controls another app.
- The Jev API key is stored under Keychain service `ai.typesafe.jev-cu` and account `api-key`.
- The key must never appear in MCP inputs/results, logs, process arguments, plugin configuration, or chat.
- The runtime bundle must start without `npm install` after marketplace installation.
- STDIO stdout is reserved for MCP protocol messages; diagnostics go to stderr.
- English and Simplified Chinese macOS accessibility roles map to stable canonical role names.
- Jev may select only a candidate submitted in the same `jev_decide` call.
- Claude Desktop installation and macOS UI control remain out of scope; only host-neutral interfaces are shipped.

## Review Focus

- A Chinese AX snapshot whose role label overlaps a shorter role must use longest-role matching and retain the correct label; Task 2 pins this with `单选按钮` and `按钮` in one fixture.
- An AX tree with more than 40 clickable elements must return exactly 40 ranked candidates plus `clipped: true` and the original clickable count; Task 2 pins this bound.
- A `401`, `403`, `429`, or malformed Jev response must become a stable error code without leaking response headers or the API key; Task 3 pins each class.
- Cancelling the native secret dialog or failing to unlock Keychain must return a structured non-secret result and leave the prior credential untouched; Task 4 pins both paths.
- MCP startup must emit no banners or logs on stdout before the JSON-RPC handshake; Task 6 pins this by spawning the bundled launcher.

---

## File Structure

- `.agents/plugins/marketplace.json`: Git marketplace metadata and the `jev-cu` source entry.
- `package.json`: repository-level development commands delegating to the plugin package.
- `plugins/jev-cu/.codex-plugin/plugin.json`: Codex plugin manifest.
- `plugins/jev-cu/.mcp.json`: relative STDIO server configuration.
- `plugins/jev-cu/bin/jev-cu-mcp`: dependency-free launcher for the bundled server.
- `plugins/jev-cu/dist/server.mjs`: committed esbuild runtime bundle used after installation.
- `plugins/jev-cu/package.json`: runtime/build/test dependencies and scripts.
- `plugins/jev-cu/server/candidates.mjs`: AX role canonicalization, parsing, ranking, bounds, and context extraction.
- `plugins/jev-cu/server/policy.mjs`: pure local safety gate.
- `plugins/jev-cu/server/jev-client.mjs`: TypeSafe request creation, retries, response normalization, and stable errors.
- `plugins/jev-cu/server/credentials.mjs`: Keychain read/write/delete operations behind an injectable process runner.
- `plugins/jev-cu/server/setup-dialog.mjs`: hidden macOS dialog and terminal secret prompt adapters.
- `plugins/jev-cu/server/tool-handlers.mjs`: host-neutral implementations of the four MCP tools.
- `plugins/jev-cu/server/index.mjs`: MCP SDK registration and STDIO transport only.
- `plugins/jev-cu/scripts/configure-key.mjs`: interactive recovery CLI.
- `plugins/jev-cu/scripts/clear-key.mjs`: narrowly scoped credential removal CLI.
- `plugins/jev-cu/scripts/build.mjs`: esbuild entry point producing the committed bundle.
- `plugins/jev-cu/skills/jev-use/SKILL.md`: outer observe/decide/act/verify workflow.
- `plugins/jev-cu/skills/jev-use/references/runtime.md`: exact MCP plus Computer Use call sequence.
- `plugins/jev-cu/fixtures/ax/*.txt`: English and Chinese AX regression snapshots.
- `plugins/jev-cu/tests/*.test.mjs`: unit, contract, and spawned STDIO integration tests.
- `README.md`: remote marketplace install, first-use setup, usage, and troubleshooting.

### Task 1: Marketplace and Plugin Skeleton

**Files:**
- Create: `.agents/plugins/marketplace.json`
- Create: `plugins/jev-cu/.codex-plugin/plugin.json`
- Create: `plugins/jev-cu/package.json`
- Create: `plugins/jev-cu/tests/plugin-contract.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Codex marketplace schema from the plugin-creator skill.
- Produces: marketplace name `jev-cu-community`, plugin name `jev-cu`, plugin version `0.2.0`, and repository-level `npm test`, `npm run build`, and `npm run validate` commands.

- [ ] **Step 1: Scaffold the repo-local marketplace and plugin directory**

Run from the repository root:

```bash
python3 /Users/soar/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py \
  jev-cu \
  --path "$PWD/plugins" \
  --marketplace-path "$PWD/.agents/plugins/marketplace.json" \
  --marketplace-name jev-cu-community \
  --with-skills \
  --with-scripts \
  --with-marketplace
```

Set the marketplace entry to `source.path: "./plugins/jev-cu"`, `policy.installation: "AVAILABLE"`, `policy.authentication: "ON_INSTALL"`, and `category: "Productivity"`.

- [ ] **Step 2: Write the failing manifest contract test**

Create `plugins/jev-cu/tests/plugin-contract.test.mjs` with assertions equivalent to:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const readJson = (url) => JSON.parse(fs.readFileSync(url, "utf8"));

test("marketplace points to the namesake plugin", () => {
  const market = readJson(new URL("../../../.agents/plugins/marketplace.json", import.meta.url));
  const manifest = readJson(new URL("../.codex-plugin/plugin.json", import.meta.url));
  assert.equal(market.name, "jev-cu-community");
  assert.deepEqual(market.plugins.map((item) => [item.name, item.source.path]), [
    ["jev-cu", "./plugins/jev-cu"],
  ]);
  assert.equal(manifest.name, "jev-cu");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(Object.hasOwn(manifest, "mcpServers"), false);
});
```

- [ ] **Step 3: Run the contract test and verify the intended metadata failures**

Run: `node --test plugins/jev-cu/tests/plugin-contract.test.mjs`

Expected: FAIL until the generated marketplace name, version, repository URL, interface metadata, and paths are updated.

- [ ] **Step 4: Finalize package and plugin metadata**

Set the plugin manifest to real values: author `rainhan99`, repository and homepage `https://github.com/rainhan99/Jev-cu`, license `ISC`, skills path `./skills/`, category `Productivity`, and no `mcpServers` field yet. Create `plugins/jev-cu/package.json` with Node `>=20`, `type: module`, and scripts `test`, `build`, and `validate`. Add `@modelcontextprotocol/sdk` and `zod` as dependencies and `esbuild` as a development dependency. Make root commands delegate with `npm --prefix plugins/jev-cu run <command>`.

- [ ] **Step 5: Install locked development dependencies and pass the contract test**

Run: `npm install --prefix plugins/jev-cu`

Run: `npm test`

Expected: PASS for the plugin contract and the pre-existing legacy suite.

- [ ] **Step 6: Validate and commit the skeleton**

Run:

```bash
python3 /Users/soar/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/jev-cu
git diff --check
git add .agents package.json package-lock.json .gitignore plugins/jev-cu
git commit -m "build: scaffold jev-cu Codex plugin"
```

Expected: plugin validation succeeds and the commit contains no generated `node_modules`.

### Task 2: Bilingual Accessibility Candidate Core

**Files:**
- Create: `plugins/jev-cu/server/candidates.mjs`
- Create: `plugins/jev-cu/fixtures/ax/calendar-en.txt`
- Create: `plugins/jev-cu/fixtures/ax/activity-monitor-zh.txt`
- Create: `plugins/jev-cu/tests/candidates.test.mjs`

**Interfaces:**
- Consumes: raw AX text and a user goal string.
- Produces: `parseAccessibilitySnapshot(text) -> AXElement[]`, `collectCandidates(text, goal, options) -> {candidates, context, diagnostics}`, and canonical `AXElement` values shaped as `{index, role, label, depth}`.

- [ ] **Step 1: Add English and Chinese regression fixtures**

Copy the existing Calendar fixture into `calendar-en.txt`. Build `activity-monitor-zh.txt` from the observed Chinese AX shape and include at least one each of `按钮`, `单选按钮`, `复选框`, `文本栏`, `工具栏`, and an unknown role.

- [ ] **Step 2: Write failing parser and bound tests**

Create tests that assert:

```js
const zh = parseAccessibilitySnapshot(readFixture("activity-monitor-zh.txt"));
assert.equal(zh.find((item) => item.index === 3).role, "radio button");
assert.equal(zh.find((item) => item.index === 3).label, "CPU");

const result = collectCandidates(makeManyButtons(45), "open item 44", { max: 40 });
assert.equal(result.candidates.length, 40);
assert.equal(result.diagnostics.clipped, true);
assert.equal(result.diagnostics.totalClickable, 45);
assert.ok(result.candidates.some((item) => item.label === "item 44"));

const unknown = collectCandidates("0 神秘控件 Example", "example");
assert.deepEqual(unknown.diagnostics.unknownRoles, ["神秘控件"]);
```

- [ ] **Step 3: Run the candidate tests and verify RED**

Run: `node --test plugins/jev-cu/tests/candidates.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/candidates.mjs`.

- [ ] **Step 4: Implement canonical roles and longest-first parsing**

Define a frozen mapping whose English and Chinese aliases include:

```js
const ROLE_ALIASES = Object.freeze({
  "standard window": "window",
  "标准窗口": "window",
  "radio button": "radio button",
  "单选按钮": "radio button",
  "check box": "checkbox",
  "checkbox": "checkbox",
  "复选框": "checkbox",
  "search field": "search field",
  "搜索栏": "search field",
  "text field": "text field",
  "文本栏": "text field",
  "pop up button": "pop up button",
  "弹出式按钮": "pop up button",
  "toggle button": "toggle button",
  "切换按钮": "toggle button",
  "menu item": "menu item",
  "菜单项": "menu item",
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
});
```

Sort aliases by descending length before matching, remove AX metadata suffixes, retain unknown roles in diagnostics, rank clickable candidates with the existing goal-token heuristic, cap `max` to `1..80`, and cap returned labels to 120 characters.

- [ ] **Step 5: Pass candidate tests and preserve legacy behavior**

Run: `node --test plugins/jev-cu/tests/candidates.test.mjs tests/core.test.mjs`

Expected: PASS, including previous/next month ranking and Chinese role canonicalization.

- [ ] **Step 6: Commit the candidate core**

```bash
git add plugins/jev-cu/server/candidates.mjs plugins/jev-cu/fixtures plugins/jev-cu/tests/candidates.test.mjs
git commit -m "feat: normalize English and Chinese AX candidates"
```

### Task 3: Jev Client and Safety Policy

**Files:**
- Create: `plugins/jev-cu/server/jev-client.mjs`
- Create: `plugins/jev-cu/server/policy.mjs`
- Create: `plugins/jev-cu/tests/jev-client.test.mjs`
- Create: `plugins/jev-cu/tests/policy.test.mjs`

**Interfaces:**
- Consumes: `{goal, app, candidates, context, recentActions, constraints}` plus injected `{apiKey, fetchImpl, sleepImpl}`.
- Produces: `requestDecision(input, deps) -> Promise<Decision>`, `JevError` with codes `authentication_failed`, `rate_limited`, `service_unavailable`, `network_failed`, and `invalid_response`, and `evaluatePolicy(input) -> PolicyResult`.

- [ ] **Step 1: Write failing client response and secret-leak tests**

Pin a successful normalized decision and these failures:

```js
await assert.rejects(
  requestDecision(validInput, { apiKey: "secret-key", fetchImpl: response(401, {}) }),
  (error) => error.code === "authentication_failed" && !error.message.includes("secret-key"),
);
await assert.rejects(
  requestDecision(validInput, { apiKey: "secret-key", fetchImpl: response(200, { answers: {} }) }),
  (error) => error.code === "invalid_response",
);
```

Use injected `sleepImpl` to assert that `429` and `5xx` retry at most twice, while `401` and `403` never retry. Assert that request bodies contain only bounded candidate descriptions and no raw AX snapshot.

- [ ] **Step 2: Write failing policy tests**

Cover unknown target IDs, probability values outside `0..1`, low confidence, sensitive Chinese and English labels, disallowed apps, `ask_user`, and a safe Calendar navigation. Assert the exact verdicts `proceed`, `done`, `confirm`, `escalate`, or `stop`.

- [ ] **Step 3: Run the client and policy tests and verify RED**

Run: `node --test plugins/jev-cu/tests/jev-client.test.mjs plugins/jev-cu/tests/policy.test.mjs`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Implement the bounded Jev client**

Port question construction and decision normalization from `scripts/jev-decide.mjs`. Validate that `target.choice` matches `/^i\d+$/` and exists in the current criteria. Abort each request after 60 seconds, retry only `429` and `5xx`, and translate fetch exceptions into `network_failed`. Construct user-safe errors without headers, authorization values, request bodies, or raw service payloads.

- [ ] **Step 5: Implement the pure policy gate**

Port the current thresholds and sensitive-label patterns. Require finite `confidence`, `risk`, and `done` values in `0..1`; reject a target missing from the submitted candidate IDs; and keep confirmation rules for deletion, sending, payment, credentials, authorization, upload/share, installation, and system settings.

- [ ] **Step 6: Pass focused and legacy tests**

Run: `node --test plugins/jev-cu/tests/jev-client.test.mjs plugins/jev-cu/tests/policy.test.mjs tests/core.test.mjs`

Expected: PASS with no real network request.

- [ ] **Step 7: Commit the decision core**

```bash
git add plugins/jev-cu/server/jev-client.mjs plugins/jev-cu/server/policy.mjs plugins/jev-cu/tests
git commit -m "feat: add bounded Jev decision core"
```

### Task 4: Keychain Credential and Hidden Setup Adapters

**Files:**
- Create: `plugins/jev-cu/server/credentials.mjs`
- Create: `plugins/jev-cu/server/setup-dialog.mjs`
- Create: `plugins/jev-cu/scripts/configure-key.mjs`
- Create: `plugins/jev-cu/scripts/clear-key.mjs`
- Create: `plugins/jev-cu/tests/credentials.test.mjs`
- Create: `plugins/jev-cu/tests/setup-dialog.test.mjs`

**Interfaces:**
- Consumes: injectable `spawnImpl(command, args, options)` and prompt adapters.
- Produces: `createCredentialStore(deps)` with `status()`, `read()`, `write(secret)`, and `clear()`; `promptForApiKey(deps) -> {status: "saved"|"cancelled"}`; and CLI exit codes `0` success, `2` cancelled, `1` failure.

- [ ] **Step 1: Write failing Keychain tests**

Assert exact executable paths and argument arrays:

```js
assert.deepEqual(calls[0].slice(0, 2), [
  "/usr/bin/security",
  ["find-generic-password", "-a", "api-key", "-s", "ai.typesafe.jev-cu", "-w"],
]);
assert.deepEqual(calls[1][1], [
  "add-generic-password", "-a", "api-key", "-s", "ai.typesafe.jev-cu", "-U", "-w",
]);
assert.equal(calls[1][1].includes("secret-key"), false);
assert.equal(calls[1][2].stdin, "secret-key\n");
```

Also assert that Keychain exit code `44` means `configured: false`, a locked Keychain becomes `credential_unavailable`, and a failed write leaves the existing entry untouched.

- [ ] **Step 2: Write failing native-dialog tests**

Inject fake `osascript` and credential store implementations. Assert that cancellation does not call `write`, success calls it exactly once, and tool-visible results contain only `{status: "saved"}` or `{status: "cancelled"}`. Scan serialized results for the fake secret.

- [ ] **Step 3: Run credential tests and verify RED**

Run: `node --test plugins/jev-cu/tests/credentials.test.mjs plugins/jev-cu/tests/setup-dialog.test.mjs`

Expected: FAIL because the credential modules do not exist.

- [ ] **Step 4: Implement Keychain operations without shell interpolation**

Use `child_process.spawn` with `shell: false`. For writes, invoke `/usr/bin/security add-generic-password ... -U -w`, keep `-w` last so `security` reads from stdin, write the secret plus a newline to the child's stdin, and collect bounded stderr only for internal error classification. For reads, capture stdout internally and never log it. For clear, delete exactly the configured service/account pair.

- [ ] **Step 5: Implement hidden native and terminal prompts**

Use `/usr/bin/osascript` with a fixed AppleScript program containing `display dialog`, `default answer ""`, and `with hidden answer`; no secret may appear in the AppleScript argument. Parse the captured answer only in memory and pass it to the credential store. The recovery CLI uses raw TTY input with echo disabled in a `try/finally`, restores terminal state on `SIGINT`, and prints only status text.

- [ ] **Step 6: Pass tests and manually verify cancellation**

Run: `node --test plugins/jev-cu/tests/credentials.test.mjs plugins/jev-cu/tests/setup-dialog.test.mjs`

Run: `node plugins/jev-cu/scripts/configure-key.mjs --test-cancel`

Expected: automated tests PASS; the test-cancel mode exits `2` without modifying Keychain.

- [ ] **Step 7: Commit credential handling**

```bash
git add plugins/jev-cu/server/credentials.mjs plugins/jev-cu/server/setup-dialog.mjs plugins/jev-cu/scripts plugins/jev-cu/tests
git commit -m "feat: store Jev credentials in macOS Keychain"
```

### Task 5: Host-neutral MCP Tool Handlers

**Files:**
- Create: `plugins/jev-cu/server/tool-handlers.mjs`
- Create: `plugins/jev-cu/server/index.mjs`
- Create: `plugins/jev-cu/tests/tool-handlers.test.mjs`
- Create: `plugins/jev-cu/tests/mcp-contract.test.mjs`

**Interfaces:**
- Consumes: candidate core, credential store, Jev client, policy gate, and setup dialog.
- Produces: handlers `status()`, `configure()`, `candidates(input)`, and `decide(input)` plus an MCP server exposing `jev_status`, `jev_configure`, `jev_candidates`, and `jev_decide`.

- [ ] **Step 1: Write failing handler tests**

Assert these stable results:

```js
assert.deepEqual(await handlers.status(), {
  platform: "darwin",
  configured: false,
  ready: false,
  code: "not_configured",
});

const parsed = await handlers.candidates({
  accessibility_text: chineseFixture,
  goal: "打开 CPU 标签页",
  max_candidates: 40,
});
assert.ok(parsed.candidates.some((item) => item.role === "radio button"));

const decision = await handlers.decide({
  goal: "Switch to the previous month",
  app: "Calendar",
  candidates: [{ id: "i56", index: 56, role: "button", label: "previous month" }],
  context: "September 2026",
});
assert.equal(decision.policy.verdict, "proceed");
```

Add cases for non-macOS, missing key, configure cancellation, Jev selecting `i999`, unsafe labels, more than 80 supplied candidates, and result serialization containing neither the fake key nor Authorization header.

- [ ] **Step 2: Run handler tests and verify RED**

Run: `node --test plugins/jev-cu/tests/tool-handlers.test.mjs`

Expected: FAIL because `server/tool-handlers.mjs` does not exist.

- [ ] **Step 3: Implement pure handlers with dependency injection**

Export `createToolHandlers({platform, credentials, promptForApiKey, requestDecision})`. Validate all inputs before reading Keychain or calling the network. Return `{decision, policy, usage}` from `decide`, with `usage` limited to model name, latency, input-token count, and estimated cost. Never include the raw Jev response.

- [ ] **Step 4: Write failing MCP schema registration tests**

Instantiate the server with fake dependencies and assert the four tool names, descriptions, required fields, maximum string lengths, candidate maximum `80`, and structured results. Assert that `jev_configure` accepts no secret input field.

- [ ] **Step 5: Register tools with the official SDK**

Keep `server/index.mjs` limited to `McpServer`, Zod schemas, error-to-result mapping, and `StdioServerTransport`. Provide `startServer(deps)` for tests and run it only when the module is the process entry point. Send diagnostics through `console.error`; do not call `console.log`.

- [ ] **Step 6: Pass all MCP unit and contract tests**

Run: `node --test plugins/jev-cu/tests/tool-handlers.test.mjs plugins/jev-cu/tests/mcp-contract.test.mjs`

Expected: PASS with fake credentials and HTTP transport.

- [ ] **Step 7: Commit MCP behavior**

```bash
git add plugins/jev-cu/server/tool-handlers.mjs plugins/jev-cu/server/index.mjs plugins/jev-cu/tests
git commit -m "feat: expose Jev decisions over MCP"
```

### Task 6: Bundled STDIO Runtime and Plugin Wiring

**Files:**
- Create: `plugins/jev-cu/scripts/build.mjs`
- Create: `plugins/jev-cu/bin/jev-cu-mcp`
- Create: `plugins/jev-cu/dist/server.mjs`
- Create: `plugins/jev-cu/.mcp.json`
- Create: `plugins/jev-cu/tests/stdio-smoke.test.mjs`
- Modify: `plugins/jev-cu/.codex-plugin/plugin.json`
- Modify: `plugins/jev-cu/tests/plugin-contract.test.mjs`

**Interfaces:**
- Consumes: `server/index.mjs` and its four registered tools.
- Produces: an executable relative launcher and a dependency-free bundled server referenced by the plugin manifest.

- [ ] **Step 1: Write the failing bundle and STDIO smoke tests**

The test must assert that `.mcp.json` contains:

```json
{
  "mcpServers": {
    "jev": {
      "command": "./bin/jev-cu-mcp",
      "args": [],
      "cwd": ".",
      "env_vars": []
    }
  }
}
```

Spawn `bin/jev-cu-mcp`, use the SDK client over STDIO to call `tools/list` and `jev_status`, and capture raw stdout before the first protocol frame. Assert the tool names are exactly the four names from Task 5 and there is no banner text.

- [ ] **Step 2: Run the smoke test and verify RED**

Run: `node --test plugins/jev-cu/tests/stdio-smoke.test.mjs`

Expected: FAIL because the launcher, bundle, and MCP config do not exist.

- [ ] **Step 3: Add deterministic bundling and launcher**

Configure esbuild with entry `server/index.mjs`, platform `node`, format `esm`, target `node20`, bundle enabled, sourcemap disabled, legal comments externalized, and output `dist/server.mjs`. Create `bin/jev-cu-mcp` as a POSIX shell script that resolves its own directory and executes `node "$SCRIPT_DIR/../dist/server.mjs"`; mark it executable.

- [ ] **Step 4: Wire MCP into the manifest**

Create `.mcp.json` with the exact relative configuration from Step 1. Add `"mcpServers": "./.mcp.json"` to `plugin.json`. Extend the contract test to verify both referenced files exist and that the launcher is executable.

- [ ] **Step 5: Build and pass the spawned integration test**

Run:

```bash
npm run build
node --test plugins/jev-cu/tests/stdio-smoke.test.mjs
npm test
```

Expected: PASS; the spawned process lists four tools, `jev_status` reports readiness without revealing a secret, and stderr contains no stack trace.

- [ ] **Step 6: Validate bundle reproducibility and commit**

Run:

```bash
npm run build
git diff --exit-code -- plugins/jev-cu/dist/server.mjs
python3 /Users/soar/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/jev-cu
git add plugins/jev-cu
git commit -m "build: bundle Jev STDIO MCP server"
```

Expected: the second build leaves the committed bundle unchanged and plugin validation succeeds.

### Task 7: Codex Skill Workflow and Documentation

**Files:**
- Create: `plugins/jev-cu/skills/jev-use/SKILL.md`
- Create: `plugins/jev-cu/skills/jev-use/references/runtime.md`
- Move: `skill/jev-use/references/calendar-demo.md` to `plugins/jev-cu/skills/jev-use/references/calendar-demo.md`
- Modify: `README.md`
- Delete: `skill/jev-use/`
- Delete: `scripts/install-skill.mjs`
- Delete after coverage migration: `scripts/loop.mjs`, `scripts/jev-decide.mjs`, `scripts/policy.mjs`, `tests/core.test.mjs`

**Interfaces:**
- Consumes: the four MCP tools and Codex Computer Use.
- Produces: an instruction-only loop in which Codex observes through Computer Use, calls Jev MCP tools as separate model tool calls, executes one approved action, and verifies the new state.

- [ ] **Step 1: Write the revised skill as a behavioral specification**

The skill must require this sequence:

1. Call `jev_status`; when `not_configured`, explain the native hidden dialog and call `jev_configure` only after explicit user agreement.
2. Open the target app through Computer Use and read a full AX state.
3. Call `jev_candidates` with only the necessary AX text, goal, and a maximum of 40 candidates.
4. Call `jev_decide` with the returned candidate list and bounded context.
5. Stop on `confirm`, `escalate`, `stop`, or any structured error.
6. On `proceed`, perform exactly one Computer Use action using the current candidate index.
7. Observe a fresh full AX state and verify a concrete success predicate before continuing.
8. Stop after two identical no-progress actions or the agreed step budget.

Explicitly prohibit importing repository modules into `cua_repl`, calling TypeSafe from `cua_repl`, passing screenshots to Jev, reusing stale AX indices, and treating Jev's `done` probability as proof.

- [ ] **Step 2: Replace the runtime reference with MCP-oriented examples**

Document tool input/output examples with redacted synthetic candidates and show Computer Use calls separately. Keep the Calendar demo, but update role examples to canonical English field values while allowing Chinese labels.

- [ ] **Step 3: Validate the skill**

Run:

```bash
python3 /Users/soar/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/jev-cu/skills/jev-use
rg -n 'TYPESAFE_API_KEY|\.env\.local|import\(|runTask|createCuaDriver' plugins/jev-cu/skills README.md
```

Expected: skill validation succeeds; the search has no old direct-network or imported-loop instructions.

- [ ] **Step 4: Rewrite install and first-use documentation**

README must give these primary commands:

```bash
codex plugin marketplace add rainhan99/Jev-cu
codex plugin add jev-cu@jev-cu-community
```

Then instruct the user to start a new Codex task, invoke `$jev-use`, and approve the native hidden setup dialog on first use. Document `npm test`, `npm run build`, Keychain service/account names, `401/403`, `429/5xx`, plugin upgrade, full Codex restart if the MCP tool list is stale, and the deferred Claude Desktop boundary.

- [ ] **Step 5: Migrate remaining regression coverage and remove the legacy runtime**

Move every still-relevant assertion from `tests/core.test.mjs` into candidate, client, policy, or handler tests. Run the full suite before deleting the old loop, direct `.env.local` loader, skill installer, and legacy tests. Preserve `scripts/p0-eval.mjs` only if it is rewritten to import the new client and read Keychain; otherwise remove it and its package script.

- [ ] **Step 6: Pass documentation and full regression checks**

Run:

```bash
npm test
npm run build
npm run validate
git diff --check
```

Expected: all tests pass, skill and plugin validators succeed, and no tracked file instructs users to put secrets in `.env.local`.

- [ ] **Step 7: Commit the skill and migration**

```bash
git add README.md package.json plugins/jev-cu skill scripts tests fixtures
git commit -m "docs: switch jev-use to the MCP workflow"
```

### Task 8: Local Installation and Harmless End-to-End Verification

**Files:**
- Modify if defects are found: files owned by Tasks 1-7
- Update: `plugins/jev-cu/.codex-plugin/plugin.json` through the plugin-creator cachebuster helper

**Interfaces:**
- Consumes: the complete marketplace and plugin.
- Produces: a locally installed Codex plugin, a configured Keychain item, and evidence that one harmless Calendar navigation can be decided and verified.

- [ ] **Step 1: Run the complete automated verification from a clean process**

```bash
npm ci --prefix plugins/jev-cu
npm test
npm run build
npm run validate
git diff --check
```

Expected: all commands exit `0`; the build does not change `dist/server.mjs`.

- [ ] **Step 2: Add the repository as a local marketplace and install the plugin**

Run with the repository's absolute path:

```bash
codex plugin marketplace add /Users/soar/Documents/Playground/Jev-cu
codex plugin add jev-cu@jev-cu-community --json
```

Expected: Codex reports the installed plugin and its MCP server without changing the repository worktree.

- [ ] **Step 3: Start a fresh Codex task and verify first-use setup**

Invoke `$jev-use`, call `jev_status`, approve `jev_configure`, enter the existing key in the hidden native dialog, and call `jev_status` again. Expected: status changes from `not_configured` to `ready`; no message, log, or MCP result contains the key.

- [ ] **Step 4: Perform one harmless Calendar smoke task**

Ask Jev to identify the Calendar button for moving one month backward, let Computer Use execute one click, and verify the visible month title changed to the immediately preceding month. Do not create, edit, or delete an event. Expected: one valid candidate is selected, policy returns `proceed`, the action is executed once, and the fresh AX state proves the title change.

- [ ] **Step 5: Apply the development cachebuster and reinstall after any smoke fix**

If Step 3 or 4 required a code change, run:

```bash
python3 /Users/soar/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py plugins/jev-cu
codex plugin add jev-cu@jev-cu-community
```

Then start another fresh Codex task and repeat only the failed smoke step.

- [ ] **Step 6: Final verification commit**

```bash
npm test
npm run build
npm run validate
git status --short
git add plugins/jev-cu README.md package.json package-lock.json
git commit -m "test: verify Codex MCP installation"
```

Expected: tests and validators pass; `git status --short` is clean after the commit. Do not push until the user explicitly confirms the target remote and asks for publication.
