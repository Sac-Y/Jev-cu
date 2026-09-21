import { spawn } from "node:child_process";

export const KEYCHAIN_SERVICE = "ai.typesafe.jev-cu";
export const KEYCHAIN_ACCOUNT = "api-key";

export class CredentialError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = "CredentialError";
    this.code = code;
  }
}

function appendBounded(current, chunk, maximum) {
  if (current.length >= maximum) return current;
  return (current + chunk.toString("utf8")).slice(0, maximum);
}

export function runProcess(command, args, { stdin, maxOutputBytes = 65_536 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk, maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk, maxOutputBytes);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

function isMissing(result) {
  return result.code === 44 || /could not be found|item not found/i.test(result.stderr);
}

function unavailable(cause) {
  return new CredentialError("credential_unavailable", "The Jev credential is unavailable in macOS Keychain", { cause });
}

export function createCredentialStore({ spawnImpl = runProcess } = {}) {
  const findArgs = [
    "find-generic-password",
    "-a", KEYCHAIN_ACCOUNT,
    "-s", KEYCHAIN_SERVICE,
    "-w",
  ];

  async function find() {
    let result;
    try {
      result = await spawnImpl("/usr/bin/security", findArgs, {});
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.code === 0) return { configured: true, secret: result.stdout.replace(/\r?\n$/, "") };
    if (isMissing(result)) return { configured: false, secret: null };
    throw unavailable();
  }

  return {
    async status() {
      const result = await find();
      return { configured: result.configured };
    },

    async read() {
      const result = await find();
      if (!result.configured || !result.secret) {
        throw new CredentialError("not_configured", "The Jev credential is not configured");
      }
      return result.secret;
    },

    async write(secret) {
      if (typeof secret !== "string" || secret.length === 0) {
        throw new CredentialError("invalid_credential", "The Jev credential cannot be empty");
      }
      const args = [
        "add-generic-password",
        "-a", KEYCHAIN_ACCOUNT,
        "-s", KEYCHAIN_SERVICE,
        "-U",
        "-w",
      ];
      let result;
      try {
        result = await spawnImpl("/usr/bin/security", args, { stdin: `${secret}\n` });
      } catch (cause) {
        throw unavailable(cause);
      }
      if (result.code !== 0) throw unavailable();
      return { configured: true };
    },

    async clear() {
      const args = [
        "delete-generic-password",
        "-a", KEYCHAIN_ACCOUNT,
        "-s", KEYCHAIN_SERVICE,
      ];
      let result;
      try {
        result = await spawnImpl("/usr/bin/security", args, {});
      } catch (cause) {
        throw unavailable(cause);
      }
      if (result.code === 0) return { cleared: true };
      if (isMissing(result)) return { cleared: false };
      throw unavailable();
    },
  };
}
