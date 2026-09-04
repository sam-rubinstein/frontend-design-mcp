import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

test("Claude, Grok, and Codex plugin metadata exposes the shared skill and MCP server", async () => {
  const claudePlugin = await readJson(".claude-plugin/plugin.json");
  const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");
  const codexPlugin = await readJson(".codex-plugin/plugin.json");
  const codexMarketplace = await readJson(".agents/plugins/marketplace.json");

  assert.equal(claudePlugin.name, "frontend-design");
  assert.equal(claudePlugin.skills, "./skills/");
  assert.equal(claudePlugin.mcpServers, "./.mcp.json");
  assert.equal(codexPlugin.name, "frontend-design");
  assert.equal(codexPlugin.skills, "./skills/");
  assert.equal(codexPlugin.mcpServers, "./.mcp.json");

  const root = resolve(".");
  const skillPath = resolve(root, "skills/design-md/SKILL.md");
  const claudeMcpPath = resolve(root, claudePlugin.mcpServers as string);
  const codexMcpPath = resolve(root, codexPlugin.mcpServers as string);
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^name: design-md$/m);
  assert.match(skill, /get_project_design/);

  const claudeMcp = await readJson(claudeMcpPath);
  const codexMcp = await readJson(codexMcpPath);
  for (const mcp of [claudeMcp, codexMcp]) {
    const servers = mcp.mcpServers as JsonObject;
    const design = servers.design as JsonObject;
    assert.equal(design.command, "npx");
    assert.deepEqual(design.args, ["-y", "frontend-design-mcp@0.1.0"]);
  }

  const claudePlugins = claudeMarketplace.plugins as JsonObject[];
  const codexPlugins = codexMarketplace.plugins as JsonObject[];
  assert.equal(claudePlugins.length, 1);
  assert.equal(codexPlugins.length, 1);
  assert.equal(claudePlugins[0]?.name, "frontend-design");
  assert.equal(claudePlugins[0]?.source, "./");
  assert.equal(codexPlugins[0]?.name, "frontend-design");
  assert.deepEqual(codexPlugins[0]?.source, { source: "local", path: "./" });
});
