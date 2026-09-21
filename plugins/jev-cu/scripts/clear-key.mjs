#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { createCredentialStore } from "../server/credentials.mjs";

export async function main() {
  const result = await createCredentialStore().clear();
  process.stderr.write(result.cleared
    ? "Jev API key removed from macOS Keychain.\n"
    : "No Jev API key was stored in macOS Keychain.\n");
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch(() => {
      process.stderr.write("Unable to remove the Jev API key.\n");
      process.exitCode = 1;
    });
}
