import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_SECRET_LENGTH = 4_096;
const SUPPORTED_ENV_NAMES = new Set(["TYPESAFE_API_KEY", "JEV_API_KEY"]);

export const DEFAULT_CREDENTIAL_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Jev-cu",
  "credentials.env",
);

export class CredentialError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = "CredentialError";
    this.code = code;
  }
}

function validSecret(secret) {
  return typeof secret === "string"
    && secret.length > 0
    && secret.length <= MAX_SECRET_LENGTH
    && !/[\0\r\n]/.test(secret);
}

function decodeEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export function parseEnvCredential(contents) {
  if (typeof contents !== "string" || contents.length > 65_536) {
    throw new CredentialError("invalid_credential_file", "The Jev credential file is invalid");
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !SUPPORTED_ENV_NAMES.has(match[1])) continue;
    const secret = decodeEnvValue(match[2]);
    if (validSecret(secret)) return secret;
    break;
  }
  throw new CredentialError("invalid_credential_file", "The Jev credential file is invalid");
}

function unavailable(cause) {
  return new CredentialError("credential_unavailable", "The Jev credential file is unavailable", { cause });
}

function sourceUnavailable(cause) {
  return new CredentialError(
    "credential_source_unavailable",
    "The source credential file is unavailable",
    { cause },
  );
}

export function createCredentialStore({ filePath = DEFAULT_CREDENTIAL_PATH, fsImpl = fs } = {}) {
  async function readConfigured() {
    let contents;
    try {
      contents = await fsImpl.readFile(filePath, "utf8");
    } catch (cause) {
      if (cause?.code === "ENOENT") return { configured: false, secret: null };
      throw unavailable(cause);
    }
    return { configured: true, secret: parseEnvCredential(contents) };
  }

  async function write(secret) {
    if (!validSecret(secret)) {
      throw new CredentialError("invalid_credential", "The Jev credential cannot be empty or malformed");
    }
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
      await fsImpl.chmod(directory, 0o700);
      await fsImpl.writeFile(
        temporaryPath,
        `TYPESAFE_API_KEY=${JSON.stringify(secret)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await fsImpl.chmod(temporaryPath, 0o600);
      await fsImpl.rename(temporaryPath, filePath);
      await fsImpl.chmod(filePath, 0o600);
    } catch (cause) {
      try {
        await fsImpl.unlink(temporaryPath);
      } catch {
        // The temporary file may not have been created.
      }
      throw unavailable(cause);
    }
    return { configured: true };
  }

  return {
    path: filePath,

    async status() {
      const result = await readConfigured();
      return { configured: result.configured };
    },

    async read() {
      const result = await readConfigured();
      if (!result.configured) {
        throw new CredentialError("not_configured", "The Jev credential is not configured");
      }
      return result.secret;
    },

    write,

    async importFromEnv(sourcePath) {
      let contents;
      try {
        contents = await fsImpl.readFile(sourcePath, "utf8");
      } catch (cause) {
        throw sourceUnavailable(cause);
      }
      const secret = parseEnvCredential(contents);
      await write(secret);
      return { configured: true };
    },

    async clear() {
      try {
        await fsImpl.unlink(filePath);
        return { cleared: true };
      } catch (cause) {
        if (cause?.code === "ENOENT") return { cleared: false };
        throw unavailable(cause);
      }
    },
  };
}
