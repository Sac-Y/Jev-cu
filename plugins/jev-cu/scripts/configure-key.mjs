#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { createCredentialStore } from "../server/credentials.mjs";

export async function main(args = process.argv.slice(2), { store = createCredentialStore() } = {}) {
  const fromIndex = args.indexOf("--from");
  const sourcePath = fromIndex >= 0 ? args[fromIndex + 1] : undefined;
  if (!sourcePath || args.length !== 2) {
    process.stderr.write("Usage: configure-key.mjs --from /path/to/.env.local\n");
    return 2;
  }
  await store.importFromEnv(sourcePath);
  process.stderr.write(`Jev API key imported into ${store.path}.\n`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`Unable to import the Jev API key (${error?.code ?? "unknown_error"}).\n`);
      process.exitCode = 1;
    });
}
