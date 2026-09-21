import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const readJson = (url) => JSON.parse(fs.readFileSync(url, "utf8"));

test("marketplace points to the namesake plugin", () => {
  const market = readJson(new URL("../../../.agents/plugins/marketplace.json", import.meta.url));
  const manifest = readJson(new URL("../.codex-plugin/plugin.json", import.meta.url));

  assert.equal(market.name, "jev-cu-community");
  assert.deepEqual(market.plugins.map((item) => [item.name, item.source.path]), [
    ["jev-cu", "./plugins/jev-cu"],
  ]);
  assert.deepEqual(market.plugins[0].policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });

  assert.equal(manifest.name, "jev-cu");
  assert.match(manifest.version, /^0\.2\.0(?:\+codex\.[A-Za-z0-9.-]+)?$/);
  assert.equal(manifest.repository, "https://github.com/rainhan99/Jev-cu");
  assert.equal(manifest.homepage, "https://github.com/rainhan99/Jev-cu");
  assert.equal(manifest.author.name, "rainhan99");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.interface.category, "Productivity");
  assert.equal(manifest.mcpServers, "./.mcp.json");
});

test("manifest MCP files exist and the launcher is executable", () => {
  const manifest = readJson(new URL("../.codex-plugin/plugin.json", import.meta.url));
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(fs.existsSync(new URL("../.mcp.json", import.meta.url)), true);
  const launcher = fs.statSync(new URL("../bin/jev-cu-mcp", import.meta.url));
  assert.ok((launcher.mode & 0o111) !== 0);
});
