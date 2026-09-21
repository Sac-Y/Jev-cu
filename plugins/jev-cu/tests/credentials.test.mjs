import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CredentialError,
  createCredentialStore,
  parseEnvCredential,
} from "../server/credentials.mjs";

async function tempStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jev-cu-credentials-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "config", "credentials.env");
  return { root, filePath, store: createCredentialStore({ filePath }) };
}

test("parses supported env names without evaluating shell syntax", () => {
  assert.equal(parseEnvCredential('TYPESAFE_API_KEY="secret-key"\n'), "secret-key");
  assert.equal(parseEnvCredential("export JEV_API_KEY='another-key'\n"), "another-key");
  assert.throws(
    () => parseEnvCredential("OTHER_KEY=ignored\n"),
    (error) => error instanceof CredentialError && error.code === "invalid_credential_file",
  );
});

test("writes and reads the protected local credential file", async (t) => {
  const { filePath, store } = await tempStore(t);

  assert.deepEqual(await store.status(), { configured: false });
  assert.deepEqual(await store.write("secret-key"), { configured: true });
  assert.deepEqual(await store.status(), { configured: true });
  assert.equal(await store.read(), "secret-key");

  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
  const parent = await fs.stat(path.dirname(filePath));
  assert.equal(parent.mode & 0o077, 0);
});

test("imports an existing env file without returning the secret", async (t) => {
  const { root, store } = await tempStore(t);
  const sourcePath = path.join(root, ".env.local");
  await fs.writeFile(sourcePath, "TYPESAFE_API_KEY=imported-secret\n", { mode: 0o600 });

  assert.deepEqual(await store.importFromEnv(sourcePath), { configured: true });
  assert.equal(await store.read(), "imported-secret");
  assert.equal(JSON.stringify(await store.importFromEnv(sourcePath)).includes("imported-secret"), false);
});

test("missing or malformed files report stable non-secret errors", async (t) => {
  const { root, store } = await tempStore(t);
  await assert.rejects(store.read(), (error) => error.code === "not_configured");
  await assert.rejects(
    store.importFromEnv(path.join(root, "missing.env")),
    (error) => error.code === "credential_source_unavailable",
  );
  const malformed = path.join(root, "malformed.env");
  await fs.writeFile(malformed, "TYPESAFE_API_KEY=\n", { mode: 0o600 });
  await assert.rejects(
    store.importFromEnv(malformed),
    (error) => error.code === "invalid_credential_file",
  );
});

test("clear removes only the configured credential file", async (t) => {
  const { filePath, store } = await tempStore(t);
  await store.write("secret-key");
  assert.deepEqual(await store.clear(), { cleared: true });
  await assert.rejects(fs.access(filePath));
  assert.deepEqual(await store.clear(), { cleared: false });
});
