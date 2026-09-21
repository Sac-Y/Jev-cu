# Jev-cu Codex MCP Design

Date: 2026-09-21

## Context

The current Jev-cu loop assumes that code running inside `cua_repl` can call the
public TypeSafe API directly. That assumption does not hold in the target Codex
Desktop environment: Computer Use can observe and operate the UI, but its
JavaScript runtime cannot resolve public hosts or reach a localhost proxy.

The current accessibility parser also assumes English AX role names, so a
Chinese macOS session can fail before the Jev request is made.

## Goals

- Ship Jev-cu as an installable Codex plugin for macOS.
- Move public network access into a local STDIO MCP server.
- Keep UI observation and UI actions in Codex Computer Use.
- Support English and Chinese macOS accessibility role names.
- Collect the Jev API key interactively and store it in macOS Keychain.
- Keep the MCP protocol and core modules host-neutral so Claude Desktop support
  can be added without rewriting the decision engine.

## Non-goals for the first release

- Claude Desktop installation or configuration.
- Direct macOS UI control from the MCP server.
- Windows or Linux support.
- A localhost HTTP bridge.
- Automatic migration of the legacy skill-only installation.

## Architecture

The first release has three boundaries:

1. The `jev-use` skill owns the outer workflow: observe the current UI, ask the
   MCP server for a decision, execute exactly one approved Computer Use action,
   verify the result, and repeat.
2. The local STDIO MCP server owns candidate normalization, safety policy, Jev
   API access, and credential status. It never clicks, types, or controls an app.
3. Codex Computer Use owns accessibility observation and all macOS UI actions.

The Git repository is a one-plugin marketplace so Codex can install it directly
from `rainhan99/Jev-cu`. The plugin itself lives under `plugins/jev-cu/`, which
matches Codex marketplace path conventions:

```text
Jev-cu/
├── .agents/plugins/marketplace.json
├── plugins/jev-cu/
│   ├── .codex-plugin/plugin.json
│   ├── .mcp.json
│   ├── bin/jev-cu-mcp
│   ├── dist/server.mjs
│   ├── skills/jev-use/
│   │   └── SKILL.md
│   ├── server/
│   │   ├── index.mjs
│   │   ├── candidates.mjs
│   │   ├── credentials.mjs
│   │   ├── jev-client.mjs
│   │   └── policy.mjs
│   ├── scripts/
│   │   ├── configure-key.mjs
│   │   └── clear-key.mjs
│   ├── fixtures/
│   └── tests/
└── README.md
```

The server uses the official Model Context Protocol SDK over STDIO. Its runtime
and dependencies are bundled into `dist/server.mjs`; installing the plugin does
not run a package manager. All logs go to stderr so stdout remains a valid MCP
transport.

## MCP tools

### `jev_status`

Reports whether the runtime is supported, whether a Keychain credential exists,
and whether the server is ready. It never returns the key.

### `jev_configure`

After explicit user approval, opens a native macOS password dialog, stores the
submitted value in Keychain, and returns only whether configuration succeeded or
was cancelled. The key never appears in the tool input, output, or chat.

### `jev_candidates`

Accepts accessibility text or a normalized accessibility snapshot and returns a
bounded, stable candidate list. English and Chinese AX role labels map to the
same canonical roles. The output contains only the fields required for a later
decision and action match.

### `jev_decide`

Accepts the user goal, current UI context, and normalized candidates. It applies
local safety checks, calls Jev, validates the response against the submitted
candidates, and returns a structured recommendation. It does not execute the
recommendation.

The tool schemas avoid Codex-specific names. A future Claude Desktop adapter can
register the same tools unchanged.

## Runtime flow

1. The skill asks Computer Use for the current accessibility snapshot.
2. Codex calls `jev_candidates` outside the Computer Use JavaScript runtime.
3. Codex calls `jev_decide` with the current goal and candidate list.
4. The server loads the API key from Keychain and contacts the TypeSafe API.
5. The server validates Jev's selected candidate and applies the local policy.
6. The skill asks Computer Use to perform one allowed action.
7. The skill observes the UI again and verifies the expected state change.
8. The loop stops on success, an unsafe action, repeated lack of progress, or a
   recoverable error that requires user attention.

No network request is performed inside `cua_repl`.

## Credentials and installation

Codex installs the plugin by first adding the Git repository as a marketplace
and then installing `jev-cu` from it. Marketplace installation itself has no
secure secret prompt, so first-use setup calls `jev_configure` only after the
user agrees. It displays a native macOS password dialog with hidden input. A
terminal configuration script provides the same operation for recovery. The
value is stored in macOS Keychain under a Jev-cu-specific service/account pair
by invoking `/usr/bin/security` without shell interpolation or placing the key
in process arguments.

The MCP server reads the key only when needed. The key is never placed in plugin
configuration, command-line arguments, stdout, MCP results, logs, or chat.

Re-running configuration replaces the existing Keychain item. A separate clear
command removes only the Jev-cu credential. Installer changes are scoped and
recoverable.

## Safety policy

- The server may recommend only a candidate that appeared in the submitted
  candidate list.
- Candidate count and text size are bounded before a network call.
- Unsupported, malformed, or low-confidence Jev responses are rejected.
- Password entry, credential changes, purchases, destructive actions, and other
  sensitive steps remain subject to the host's confirmation rules.
- The MCP server never exposes a generic shell, arbitrary URL fetch, or raw UI
  action tool.
- A recommendation is not treated as proof of success; Computer Use must verify
  the resulting UI state.

## Error handling

- Missing key: return a structured `not_configured` result with the local setup
  command, without repeatedly calling the API.
- Authentication failure: return `authentication_failed` and direct the user to
  reconfigure the Keychain item.
- Network or service failure: return a retryable error with bounded retries and
  no hidden fallback to direct `cua_repl` networking.
- Invalid model output: reject it locally and return the validation reason.
- No useful candidates: return a diagnostic summary that distinguishes an empty
  UI tree from an unsupported role mapping.
- No progress after repeated actions: stop and report the last verified state.

## Localization

Accessibility roles are canonicalized before filtering. The initial mapping
covers the English and Simplified Chinese role labels observed on macOS, with
fixtures for both languages. Unknown roles remain visible in diagnostics rather
than being silently discarded.

User-facing skill guidance can be written in either English or Chinese; the MCP
tool inputs and outputs use stable language-neutral field names.

## Claude Desktop extension points

Claude support is deliberately deferred, but the first release preserves these
extension points:

- The MCP server has no dependency on Codex APIs or Computer Use objects.
- Tool schemas are shared and host-neutral.
- Host installation is isolated behind installer modules, allowing a later
  Claude installer to merge an absolute STDIO command into
  `~/Library/Application Support/Claude/claude_desktop_config.json` while
  preserving existing entries and creating a backup.
- A future optional macOS UI driver will be a separate capability with its own
  permission and confirmation boundary; it will not be folded into the decision
  tools.

Thus Claude Desktop can first consume the same decision MCP, and end-to-end UI
control can be designed separately without weakening the Codex safety boundary.

## Verification

Automated tests cover:

- English and Chinese AX parsing and canonicalization.
- Candidate bounds and stable identifiers.
- Policy rejection of unknown, unsafe, and malformed selections.
- Keychain command construction with a mocked process boundary.
- Jev request, response validation, authentication, and network failures using a
  fake HTTP transport.
- MCP tool schemas and STDIO startup without stdout noise.
- Plugin manifest and configuration validation.

An integration smoke test starts the STDIO server, calls `jev_status`, exercises
`jev_candidates` with both language fixtures, and calls `jev_decide` against a
stub Jev endpoint. A final manual macOS check installs the plugin, configures a
real key, and completes a harmless one-action Computer Use task.

## Delivery sequence

1. Add failing parser, policy, credential, client, and MCP contract tests.
2. Extract the reusable core from the current scripts.
3. Implement the STDIO MCP server.
4. Package the Codex plugin and rewrite the skill workflow.
5. Add interactive Keychain setup and Codex installation.
6. Run automated and manual smoke verification.
7. Document the Claude Desktop extension points without enabling them yet.
