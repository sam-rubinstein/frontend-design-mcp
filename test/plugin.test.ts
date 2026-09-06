/**
 * The plugin manifests are the install path for three different agents, and none of them is
 * exercised by the rest of the suite: a typo here fails at a user's terminal, after install,
 * with no stack trace. These assertions are deliberately about shape and agreement rather than
 * literal strings, so a version bump does not require editing the test.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { Registry } from "../dist/providers/index.js";

// Every agent resolves the plugin from this directory rather than the repo root: Grok will not
// load a plugin whose marketplace source is the root itself, and the other two do not care.
const PLUGIN = "plugins/frontend-design";

type JsonObject = Record<string, unknown>;

// Written this way so the literal never appears in the file - otherwise a find-and-replace over
// the repo would silently rewrite the placeholder this test exists to check.
const apiKeyPlaceholder = ["$", "{DESIGNMD_API_KEY:-}"].join("");

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

test("every agent's plugin manifest exposes the shared skill and MCP server", async () => {
  const manifests = {
    claude: await readJson(`${PLUGIN}/.claude-plugin/plugin.json`),
    codex: await readJson(`${PLUGIN}/.codex-plugin/plugin.json`),
    grok: await readJson(`${PLUGIN}/.grok-plugin/plugin.json`),
  };

  for (const [agent, manifest] of Object.entries(manifests)) {
    assert.equal(manifest.name, "frontend-design", `${agent} plugin name`);
    assert.equal(manifest.skills, "./skills/", `${agent} skills path`);
    assert.equal(manifest.mcpServers, "./.mcp.json", `${agent} mcpServers path`);
  }

  const skill = await readFile(resolve(`${PLUGIN}/skills/design-md/SKILL.md`), "utf8");
  assert.match(skill, /^name: design-md$/m);
  assert.match(skill, /get_project_design/);
});

test("the MCP server is installed from npm, pinned to the exact version this repo publishes", async () => {
  const pkg = await readJson("package.json");
  // An exact pin, not a range: npx resolves this spec on every launch, so a range would let a
  // version nobody here reviewed run on a user's machine. The cost is that a release must bump
  // this file too, which the equality below enforces.
  const expectedSpec = `frontend-design-mcp@${String(pkg.version)}`;

  const mcp = await readJson(`${PLUGIN}/.mcp.json`);
  const design = (mcp.mcpServers as JsonObject).design as JsonObject;

  assert.equal(design.command, "npx");
  assert.deepEqual(design.args, ["-y", expectedSpec]);
  // A git spec cannot work here: dist/ is not committed, and pinning a commit inside the file
  // that lives in that commit is circular. Guard against a revert to one.
  assert.doesNotMatch(String((design.args as string[])[1]), /^github:|\.git($|#)/);
  assert.deepEqual(design.env, { DESIGNMD_API_KEY: apiKeyPlaceholder });
});

test("an unsubstituted API-key placeholder counts as no key, not a bad key", () => {
  const gated = new Registry({ DESIGNMD_API_KEY: apiKeyPlaceholder })
    .capabilities()
    .find((c) => c.id === "designmd.ai");
  assert.equal(gated?.canFetchContent, false);

  const keyed = new Registry({ DESIGNMD_API_KEY: "dk_real_key" })
    .capabilities()
    .find((c) => c.id === "designmd.ai");
  assert.equal(keyed?.canFetchContent, true);
});

test("each marketplace catalog lists the plugin in its own host's schema", async () => {
  const pkgVersion = (await readJson("package.json")).version;

  // Claude Code: <repo>/.claude-plugin/marketplace.json, source is a bare relative path.
  const claude = await readJson(".claude-plugin/marketplace.json");
  const claudeEntry = (claude.plugins as JsonObject[])[0];
  assert.equal((claude.plugins as JsonObject[]).length, 1);
  assert.equal(claudeEntry?.name, "frontend-design");
  assert.equal(claudeEntry?.source, `./${PLUGIN}`);
  assert.equal(claudeEntry?.version, pkgVersion);

  // Codex: <repo>/.agents/plugins/marketplace.json, structured source plus an install policy.
  const codex = await readJson(".agents/plugins/marketplace.json");
  const codexEntry = (codex.plugins as JsonObject[])[0];
  assert.equal((codex.plugins as JsonObject[]).length, 1);
  assert.equal(codexEntry?.name, "frontend-design");
  assert.deepEqual(codexEntry?.source, { source: "local", path: `./${PLUGIN}` });
  const policy = codexEntry?.policy as JsonObject;
  assert.ok(
    ["AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"].includes(String(policy?.installation)),
    `installation policy "${policy?.installation}" is not one Codex accepts`,
  );
  // ON_USE, not ON_INSTALL: the server starts without DESIGNMD_API_KEY and degrades to the
  // unauthenticated capability set, so prompting at install time would demand a key nobody needs yet.
  assert.equal(policy?.authentication, "ON_USE", "authentication policy");

  // Grok: <repo>/.grok-plugin/marketplace.json, an owner block, and a differently keyed source.
  const grok = await readJson(".grok-plugin/marketplace.json");
  const grokEntry = (grok.plugins as JsonObject[])[0];
  assert.equal((grok.plugins as JsonObject[]).length, 1);
  assert.ok((grok.owner as JsonObject)?.name, "Grok's catalog requires an owner");
  assert.equal(grokEntry?.name, "frontend-design");
  assert.deepEqual(grokEntry?.source, { type: "local", path: `./${PLUGIN}` });
  assert.equal(grokEntry?.version, pkgVersion);
});

test("the plugin version tracks the package version everywhere it is written down", async () => {
  const pkgVersion = (await readJson("package.json")).version;
  for (const path of [
    `${PLUGIN}/.claude-plugin/plugin.json`,
    `${PLUGIN}/.codex-plugin/plugin.json`,
    `${PLUGIN}/.grok-plugin/plugin.json`,
  ]) {
    assert.equal((await readJson(path)).version, pkgVersion, `${path} is out of step`);
  }

  // The version in the initialize handshake is a literal in src/, not a read of package.json,
  // and the SDK keeps serverInfo private - so this reads the build. A drift here is invisible
  // to every other assertion in this file and shows up as a client reporting a stale version.
  const built = await readFile(resolve("dist/server.js"), "utf8");
  const advertised = String(pkgVersion).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    built,
    new RegExp(`name:\\s*"frontend-design-mcp",\\s*version:\\s*"${advertised}"`),
    "the version the server advertises over MCP is out of step with package.json",
  );
});
