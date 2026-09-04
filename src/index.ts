#!/usr/bin/env node
/** stdio entry point. stdio is the one transport Claude Code, Codex and Grok all accept locally. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  // stdout is the protocol channel; diagnostics must go to stderr.
  console.error("frontend-design-mcp failed to start:", err);
  process.exit(1);
});
