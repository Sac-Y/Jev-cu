import test from "node:test";
import assert from "node:assert/strict";

import { CredentialError, createCredentialStore } from "../server/credentials.mjs";

function queuedRunner(results, calls = []) {
  return {
    calls,
    spawnImpl: async (command, args, options = {}) => {
      calls.push([command, args, options]);
      return results.shift();
    },
  };
}

test("status checks and writes the exact Keychain item without putting the secret in argv", async () => {
  const runner = queuedRunner([
    { code: 0, stdout: "old-secret\n", stderr: "" },
    { code: 0, stdout: "", stderr: "" },
  ]);
  const store = createCredentialStore({ spawnImpl: runner.spawnImpl });

  assert.deepEqual(await store.status(), { configured: true });
  assert.deepEqual(await store.write("secret-key"), { configured: true });
  assert.deepEqual(runner.calls[0].slice(0, 2), [
    "/usr/bin/security",
    ["find-generic-password", "-a", "api-key", "-s", "ai.typesafe.jev-cu", "-w"],
  ]);
  assert.deepEqual(runner.calls[1][1], [
    "add-generic-password", "-a", "api-key", "-s", "ai.typesafe.jev-cu", "-U", "-w",
  ]);
  assert.equal(runner.calls[1][1].includes("secret-key"), false);
  assert.equal(runner.calls[1][2].stdin, "secret-key\n");
});

test("read returns the secret only to the caller", async () => {
  const runner = queuedRunner([{ code: 0, stdout: "secret-key\n", stderr: "" }]);
  const store = createCredentialStore({ spawnImpl: runner.spawnImpl });
  assert.equal(await store.read(), "secret-key");
});

test("Keychain item-not-found exit code means not configured", async () => {
  const runner = queuedRunner([
    { code: 44, stdout: "", stderr: "The specified item could not be found" },
    { code: 44, stdout: "", stderr: "The specified item could not be found" },
  ]);
  const store = createCredentialStore({ spawnImpl: runner.spawnImpl });
  assert.deepEqual(await store.status(), { configured: false });
  await assert.rejects(store.read(), (error) => error.code === "not_configured");
});

test("a locked Keychain becomes credential_unavailable", async () => {
  const runner = queuedRunner([{ code: 36, stdout: "", stderr: "User interaction is not allowed" }]);
  const store = createCredentialStore({ spawnImpl: runner.spawnImpl });
  await assert.rejects(
    store.status(),
    (error) => error instanceof CredentialError && error.code === "credential_unavailable",
  );
});

test("a failed update does not fall back to deleting the previous item", async () => {
  const runner = queuedRunner([{ code: 1, stdout: "", stderr: "write failed" }]);
  const store = createCredentialStore({ spawnImpl: runner.spawnImpl });
  await assert.rejects(store.write("new-secret"), (error) => error.code === "credential_unavailable");
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0][1][0], "add-generic-password");
});

test("clear removes only the configured service and account", async () => {
  const runner = queuedRunner([{ code: 0, stdout: "", stderr: "" }]);
  const store = createCredentialStore({ spawnImpl: runner.spawnImpl });
  assert.deepEqual(await store.clear(), { cleared: true });
  assert.deepEqual(runner.calls[0].slice(0, 2), [
    "/usr/bin/security",
    ["delete-generic-password", "-a", "api-key", "-s", "ai.typesafe.jev-cu"],
  ]);
});
