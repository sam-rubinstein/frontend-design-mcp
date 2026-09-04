/**
 * Test runner with a version preflight.
 *
 * The published artifact is compiled JS and runs on Node 18, which is what `engines` declares.
 * The tests themselves execute TypeScript directly with no flag, which needs the unflagged type
 * stripping that landed in Node 22.18 (the 23.6 backport) - not 22.6, which still required
 * --experimental-strip-types. Without this check
 * a contributor on 18 or 20 just gets `Unknown file extension ".ts"`.
 */
import { spawnSync } from "node:child_process";

const REQUIRED = [22, 18];
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < REQUIRED[0] || (major === REQUIRED[0] && minor < REQUIRED[1])) {
  console.error(
    `This test suite runs TypeScript directly and needs Node >=${REQUIRED.join(".")}; ` +
      `you are on ${process.versions.node}.\n` +
      `The published package itself supports Node 18 - only the tests need a newer runtime.`,
  );
  process.exit(1);
}

const live = process.argv.includes("--live");
const build = spawnSync("npx", ["tsc"], { stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(
  process.execPath,
  [
    "--test",
    "test/markdown.test.ts",
    "test/project.test.ts",
    "test/http.test.ts",
    "test/shape.test.ts",
    "test/contract.test.ts",
  ],
  { stdio: "inherit", env: live ? { ...process.env, GETDESIGN_LIVE: "1" } : process.env },
);
process.exit(run.status ?? 1);
