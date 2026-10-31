# ORCA runtime

Repository: `{{REPO_DIR}}`. The shared skill is installed at `/Users/a1/.agents/skills/jev-cu`.
This is an on-demand tool, not a background process or a replacement for the coding model.

Read the installed `computer-use` skill and the live `orca skills get computer-use` guide before using the driver. Resolve the executable using that skill; pass `command` explicitly if needed. Inspect `list-apps` and `list-windows` for the actual app/window. Use a bundle ID in `appSelector`, with the corresponding canonical name (e.g. Calendar) in `appName` so the existing policy applies. Do not label a different app as Calendar to bypass its policy.

## Local readiness (no Jev requests)

```sh
cd "{{REPO_DIR}}"
npm run orca:check -- com.apple.iCal
```

This reads the selected app's accessibility tree and prints only counts and whether the key loads. It does not validate API credentials, perform content-changing actions, or send UI content to Jev. A visible app window is required. For window errors, follow the current computer-use guide; append `--restore-window` for a single authorized retry that brings the app window forward.

## Jev execution

Use Node, not `cua_repl`. Import the existing loop and the new driver:

```js
import { runTask } from "{{REPO_DIR}}/scripts/loop.mjs";
import { createOrcaDriver } from "{{REPO_DIR}}/scripts/orca-driver.mjs";

const driver = createOrcaDriver({ appSelector: "com.apple.iCal" });
await driver.bind("Calendar");
const currentAX = await driver.observe();
// Inspect currentAX locally. Define goal and verify from the actual task and
// observed controls/selected state; do not use button existence as success.
// Then, only within the user's authorized task and API budget:
const result = await runTask({
  driver,
  appName: "Calendar",
  goal,
  verify,
  dryRun: true,
  maxSteps: 1,
  jevOptions: { maxRetries: 0, timeoutMs: 20_000 },
});
```

`goal` and `verify` above are task-specific values the caller must supply. `dryRun: true` prevents GUI changes but **still calls the paid Jev API**. `npm test` uses mocked providers and is free. Set a small explicit `maxSteps` and `maxRetries: 0` for smoke tests; the loop's upstream default is 30 steps. Authentication is not proven until an actual successful request.

Review the dry-run decision, existing authorization and verification predicate before setting `dryRun: false`. Keep sensitive-action policy gates intact. Send only task-relevant text to Jev; filtering URLs is not privacy redaction. Use a scoped observation wrapper to exclude unrelated calendar events, messages or browser content when necessary.

## Adapter behavior

- Uses `orca computer` with a per-driver snapshot namespace and pins the observed window ID. Reuse the same driver for one task; do not share one across concurrent tasks.
- Normalizes common Korean macOS roles to English without translating labels or renumbering elements. Unsupported localized roles may still require a narrow mapping update based on observed evidence.
- Rejects truncated/empty trees and indexes not present in the latest observation. All actions, including failed actions, require a new observation before another action; mutations are never automatically retried.
- Uses stdin for text/value payloads and launches the CLI without a shell. Screenshots are disabled; coordinates, if supplied by the caller, must already be window-local.
- A successful command is not task verification. `runTask` reads fresh state after actions; provide `verify` to establish the result. Text input requires a confirmed focused receiver, as described by the computer-use skill.
- `runs/` may contain task/decision text. It is ignored by Git, as is `.env.local`. Never print the API key.

After editing the skill source, run `node scripts/install-skill.mjs --dest /Users/a1/.agents/skills/jev-cu` from the repository. The installer expands `{{REPO_DIR}}` in installed references.
