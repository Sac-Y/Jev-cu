import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const launcher = fileURLToPath(new URL("../bin/jev-cu-mcp", import.meta.url));

test("plugin config launches the relative Jev STDIO server", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../.mcp.json", import.meta.url), "utf8"));
  assert.deepEqual(config, {
    mcpServers: {
      jev: {
        command: "./bin/jev-cu-mcp",
        args: [],
        cwd: ".",
        env_vars: [],
      },
    },
  });
  assert.ok((fs.statSync(launcher).mode & 0o111) !== 0, "launcher must be executable");
});

test("the first stdout line is a JSON-RPC frame with no banner", async (t) => {
  const child = spawn(launcher, [], { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());

  const firstLine = new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("timed out waiting for MCP response")), 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const newline = stdout.indexOf("\n");
      if (newline >= 0) {
        clearTimeout(timer);
        resolve(stdout.slice(0, newline));
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== null && !stdout.includes("\n")) reject(new Error(`server exited ${code}`));
    });
  });

  child.stdin.write(serializeMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "raw-stdio-test", version: "1.0.0" },
    },
  }));
  const message = JSON.parse(await firstLine);
  assert.equal(message.jsonrpc, "2.0");
  assert.equal(message.id, 1);
  assert.equal(message.result.serverInfo.name, "jev-cu");
});

test("bundled launcher serves all tools and a non-secret status", async (t) => {
  let stderr = "";
  const transport = new StdioClientTransport({
    command: launcher,
    args: [],
    cwd: pluginRoot,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const client = new Client({ name: "jev-cu-smoke", version: "1.0.0" });
  await client.connect(transport);
  t.after(async () => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "jev_status",
    "jev_configure",
    "jev_candidates",
    "jev_decide",
  ]);
  const status = await client.callTool({ name: "jev_status", arguments: {} });
  assert.equal(status.structuredContent.platform, "darwin");
  assert.equal(status.structuredContent.ready, status.structuredContent.configured);
  assert.equal(JSON.stringify(status).includes("api-key"), false);
  assert.doesNotMatch(stderr, /(?:Error:|\n\s+at )/);
});
