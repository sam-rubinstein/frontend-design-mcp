/** Measures what each tool actually puts into the model's context. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "audit", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
  }),
);
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const est = (s) => Math.round(s.length / 4); // ~4 chars/token for English+JSON

const rows = [];
async function measure(label, name, args) {
  const t = Date.now();
  const result = await client.callTool({ name, arguments: args });
  // An error result is a string too; measuring it would silently report a tiny "cost".
  if (result.isError) {
    throw new Error(`${label} returned an error: ${textOf(result)}`);
  }
  const out = textOf(result);
  rows.push({ call: label, chars: out.length, "~tokens": est(out), ms: Date.now() - t });
}

// finally, so a failed measurement still reaps the server this script spawned.
try {
  await measure("get_design_tokens(stripe)", "get_design_tokens", {
    design_id: "getdesign:stripe",
  });
  await measure("get_design_tokens only:colors", "get_design_tokens", {
    design_id: "getdesign:stripe",
    only: "colors",
  });
  await measure("get_design_sections(stripe)", "get_design_sections", {
    design_id: "getdesign:stripe",
  });
  await measure("get_design section=Colors", "get_design", {
    design_id: "getdesign:stripe",
    section: "Colors",
  });
  await measure("get_design WHOLE DOCUMENT", "get_design", { design_id: "getdesign:stripe" });
  await measure("search_designs(limit 5)", "search_designs", { query: "stripe", limit: 5 });
  await measure("get_project_design (none)", "get_project_design", { project_root: process.cwd() });
  await measure("list_providers", "list_providers", {});

  console.table(rows);
  const whole = rows.find((r) => r.call.includes("WHOLE"))["~tokens"];
  for (const r of rows) r["vs whole doc"] = `${((r["~tokens"] / whole) * 100).toFixed(1)}%`;
  console.log("\nEvery row as a share of reading the whole document:");
  console.table(
    rows.map((r) => ({ call: r.call, "~tokens": r["~tokens"], "vs whole doc": r["vs whole doc"] })),
  );
} finally {
  await client.close();
}
