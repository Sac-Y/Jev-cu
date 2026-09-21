import test from "node:test";
import assert from "node:assert/strict";

import { promptForApiKey, runNativeSecretDialog } from "../server/setup-dialog.mjs";

test("native setup saves a submitted secret but returns only status", async () => {
  const writes = [];
  const result = await promptForApiKey({
    credentials: { write: async (secret) => writes.push(secret) },
    runDialog: async () => ({ status: "submitted", secret: "secret-key" }),
  });
  assert.deepEqual(writes, ["secret-key"]);
  assert.deepEqual(result, { status: "saved" });
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});

test("cancelling setup leaves the credential untouched", async () => {
  let writes = 0;
  const result = await promptForApiKey({
    credentials: { write: async () => { writes += 1; } },
    runDialog: async () => ({ status: "cancelled" }),
  });
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(writes, 0);
});

test("the native dialog uses an AppKit secure text field without embedding the submitted secret", async () => {
  const calls = [];
  const result = await runNativeSecretDialog({
    spawnImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, stdout: "secret-key\n", stderr: "" };
    },
  });
  assert.deepEqual(result, { status: "submitted", secret: "secret-key" });
  assert.equal(calls[0].command, "/usr/bin/osascript");
  assert.deepEqual(calls[0].args.slice(0, 3), ["-l", "JavaScript", "-e"]);
  assert.match(calls[0].args[3], /NSSecureTextField/);
  assert.match(calls[0].args[3], /NSAlert/);
  assert.match(calls[0].args[3], /setActivationPolicy/);
  assert.match(calls[0].args[3], /finishLaunching/);
  assert.match(calls[0].args[3], /runModal/);
  assert.equal(calls[0].args.join(" ").includes("secret-key"), false);
});

test("AppleScript user cancellation becomes a structured cancellation", async () => {
  const result = await runNativeSecretDialog({
    spawnImpl: async () => ({ code: 1, stdout: "", stderr: "User canceled. (-128)" }),
  });
  assert.deepEqual(result, { status: "cancelled" });
});
