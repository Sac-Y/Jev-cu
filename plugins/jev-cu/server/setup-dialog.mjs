import { runProcess } from "./credentials.mjs";

const APPLESCRIPT = [
  "set answer to display dialog \"Enter your Jev API key. It will be stored in macOS Keychain.\"",
  "default answer \"\"",
  "with title \"Jev-cu Setup\"",
  "buttons {\"Cancel\", \"Save\"}",
  "default button \"Save\"",
  "cancel button \"Cancel\"",
  "with hidden answer",
  "return text returned of answer",
].join(" ");

export class SetupError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = "SetupError";
    this.code = code;
  }
}

export async function runNativeSecretDialog({ spawnImpl = runProcess } = {}) {
  let result;
  try {
    result = await spawnImpl("/usr/bin/osascript", ["-e", APPLESCRIPT], {});
  } catch (cause) {
    throw new SetupError("setup_failed", "Unable to open the Jev credential dialog", { cause });
  }
  if (result.code !== 0) {
    if (/cancel|\(-128\)/i.test(result.stderr)) return { status: "cancelled" };
    throw new SetupError("setup_failed", "The Jev credential dialog failed");
  }
  const secret = result.stdout.replace(/\r?\n$/, "");
  if (!secret) return { status: "cancelled" };
  return { status: "submitted", secret };
}

export async function promptForApiKey({ credentials, runDialog = runNativeSecretDialog } = {}) {
  if (!credentials || typeof credentials.write !== "function") {
    throw new SetupError("setup_failed", "Credential storage is unavailable");
  }
  const result = await runDialog();
  if (result.status !== "submitted") return { status: "cancelled" };
  await credentials.write(result.secret);
  return { status: "saved" };
}

export function readHiddenLine({
  input = process.stdin,
  output = process.stderr,
  prompt = "Jev API key: ",
} = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new SetupError("tty_required", "A terminal is required for hidden credential input");
  }
  output.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk) => {
      const bytes = Buffer.from(chunk);
      for (const byte of bytes) {
        if (byte === 3) {
          cleanup();
          reject(new SetupError("cancelled", "Credential entry was cancelled"));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
        } else {
          value += Buffer.from([byte]).toString("utf8");
        }
      }
    };

    input.setEncoding(null);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
