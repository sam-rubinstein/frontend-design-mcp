/**
 * End-to-end smoke test: spawns the built server over stdio as a real MCP client would,
 * then exercises the tools that matter. Run with `npm run smoke`.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

function textOf(result) {
  return result.content.map((c) => c.text).join("\n");
}

const workdir = await mkdtemp(join(tmpdir(), "frontend-design-smoke-"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "smoke", version: "0.1.0" });

// connect() is inside the try so a failed handshake still cleans up the temp workdir.
try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check("server advertises 8 tools over stdio", names.length === 8, names.join(", "));

  const instructions = client.getInstructions?.() ?? "";
  check(
    "instructions tell clients to start with get_project_design",
    instructions.includes("get_project_design"),
  );

  const providers = JSON.parse(
    textOf(await client.callTool({ name: "list_providers", arguments: {} })),
  );
  check("three providers registered", providers.providers.length === 3);
  check(
    "designmd.ai reports content gated without a key",
    providers.providers.find((p) => p.id === "designmd.ai")?.canFetchContent === false,
  );

  const tokens = JSON.parse(
    textOf(
      await client.callTool({
        name: "get_design_tokens",
        arguments: { design_id: "getdesign:stripe" },
      }),
    ),
  );
  check(
    "get_design_tokens returns Stripe's primary",
    tokens.colors.primary === "#533afd",
    tokens.colors.primary,
  );
  check(
    "tokens are complete, not extracted",
    tokens.partial === false && tokens.source === "frontmatter",
  );

  const proseTokens = JSON.parse(
    textOf(
      await client.callTool({
        name: "get_design_tokens",
        arguments: { design_id: "getdesign:tesla" },
      }),
    ),
  );
  check(
    "a prose file degrades honestly",
    proseTokens.partial === true && Boolean(proseTokens.note),
  );

  const sections = JSON.parse(
    textOf(
      await client.callTool({
        name: "get_design_sections",
        arguments: { design_id: "getdesign:stripe" },
      }),
    ),
  );
  check(
    "get_design_sections lists sections with sizes",
    sections.sections.length > 3,
    `${sections.sections.length} sections`,
  );

  const whole = textOf(
    await client.callTool({ name: "get_design", arguments: { design_id: "getdesign:stripe" } }),
  );
  const slice = textOf(
    await client.callTool({
      name: "get_design",
      arguments: { design_id: "getdesign:stripe", section: "Colors" },
    }),
  );
  const ratio = slice.length / whole.length;
  check(
    "a section slice is under 20% of the document",
    ratio < 0.2,
    `${(ratio * 100).toFixed(1)}%`,
  );
  check("third-party content is wrapped as untrusted data", slice.includes("<design-md"));

  const search = JSON.parse(
    textOf(
      await client.callTool({ name: "search_designs", arguments: { query: "stripe", limit: 3 } }),
    ),
  );
  const searchProviders = new Set(search.results.map((r) => r.provider));
  check(
    "search fans out across providers",
    searchProviders.size >= 2,
    [...searchProviders].join(", "),
  );
  const gatedProviders = new Set(search.results.filter((r) => !r.fetchable).map((r) => r.provider));
  check(
    "every gated provider is explained once, not per row",
    gatedProviders.size > 0 && [...gatedProviders].every((p) => Boolean(search.gating?.[p])),
    Object.keys(search.gating ?? {}).join(", "),
  );

  const styleSearch = JSON.parse(
    textOf(
      await client.callTool({
        name: "search_designs",
        arguments: {
          query: "warm editorial cream",
          limit: 3,
          deep: true,
          providers: ["getdesign"],
        },
      }),
    ),
  );
  check(
    "deep search matches on style, not just brand names",
    styleSearch.results.some((r) => r.id === "getdesign:claude"),
    styleSearch.results.map((r) => r.id).join(", "),
  );

  const before = JSON.parse(
    textOf(
      await client.callTool({ name: "get_project_design", arguments: { project_root: workdir } }),
    ),
  );
  check("get_project_design reports absence cleanly", before.exists === false);

  await client.callTool({
    name: "install_design",
    arguments: { design_id: "getdesign:stripe", project_root: workdir },
  });
  const after = JSON.parse(
    textOf(
      await client.callTool({ name: "get_project_design", arguments: { project_root: workdir } }),
    ),
  );
  check("installed design is found again with its origin", after.source === "getdesign:stripe");
  check("resumed session sees the file unmodified", after.modified_since_install === false);
  check("resumed session gets colours without a network call", after.colors.primary === "#533afd");

  const onDisk = await readFile(join(workdir, "DESIGN.md"), "utf8");
  check(
    "installed file carries a provenance marker",
    onDisk.includes("frontend-design-mcp: source="),
  );

  const escapeAttempt = await client.callTool({
    name: "install_design",
    arguments: {
      design_id: "getdesign:stripe",
      project_root: workdir,
      target_path: "../escaped.md",
    },
  });
  check("install refuses to escape the project root", escapeAttempt.isError === true);

  const badId = await client.callTool({ name: "get_design", arguments: { design_id: "stripe" } });
  check(
    "a bare id is rejected with guidance",
    badId.isError === true && textOf(badId).includes("namespaced"),
  );

  const gated = await client.callTool({
    name: "get_design",
    arguments: { design_id: "getdesign:aave" },
  });
  check(
    "a gated slug explains itself",
    gated.isError === true && /Catalog Pass|public index/.test(textOf(gated)),
  );

  const updates = JSON.parse(
    textOf(await client.callTool({ name: "check_updates", arguments: {} })),
  );
  check(
    "check_updates reports catalog size",
    updates.catalog_size >= 70,
    `${updates.catalog_size} entries`,
  );
} finally {
  await client.close();
  await rm(workdir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
