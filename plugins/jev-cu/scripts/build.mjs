#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(pluginRoot, "server/index.mjs")],
  outfile: path.join(pluginRoot, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  legalComments: "external",
  logLevel: "info",
});
