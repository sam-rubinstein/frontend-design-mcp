/**
 * Proves the built server constructs on the oldest runtime `engines` promises (Node 18).
 * The test suite itself needs 22.6+, so this is the only thing guarding that claim.
 */
import { createServer } from "../dist/server.js";

const server = createServer({}, process.cwd());
if (!server) {
  console.error("createServer returned nothing");
  process.exit(1);
}
console.error(`ok: server constructed on Node ${process.versions.node}`);
