#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { createCredentialStore } from "../server/credentials.mjs";
import { readHiddenLine, SetupError } from "../server/setup-dialog.mjs";

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--test-cancel")) return 2;
  const secret = await readHiddenLine();
  if (!secret) return 2;
  await createCredentialStore().write(secret);
  process.stderr.write("Jev API key saved in macOS Keychain.\n");
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      const message = error instanceof SetupError && error.code === "cancelled"
        ? "Jev credential setup cancelled."
        : "Unable to save the Jev API key.";
      process.stderr.write(`${message}\n`);
      process.exitCode = error?.code === "cancelled" ? 2 : 1;
    });
}
