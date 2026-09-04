/** Install/detect round trip, plus the path guard on install. */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { findProjectDesign, installDesign } from "../dist/project.js";
import type { DesignDocument } from "../src/types.ts";

const doc: DesignDocument = {
  id: "getdesign:stripe",
  provider: "getdesign",
  slug: "stripe",
  content: [
    "---",
    "name: Test",
    "colors:",
    '  primary: "#533afd"',
    "---",
    "",
    "## Colors",
    "",
    "Indigo.",
  ].join("\n"),
  variant: "frontmatter",
  sha256: "irrelevant-here",
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "getdesign-mcp-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("findProjectDesign", () => {
  test("returns undefined when the project has no DESIGN.md", async () => {
    assert.equal(await findProjectDesign(root), undefined);
  });

  test("finds a hand-written DESIGN.md and reports no known source", async () => {
    await writeFile(join(root, "DESIGN.md"), doc.content, "utf8");
    const found = (await findProjectDesign(root))!;
    assert.equal(found.path, "DESIGN.md");
    assert.equal(found.source, undefined);
    assert.equal(found.tokens.colors.primary, "#533afd");
  });

  test("searches conventional subdirectories", async () => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "DESIGN.md"), doc.content, "utf8");
    const found = (await findProjectDesign(root))!;
    assert.equal(found.path, "docs/DESIGN.md");
  });
});

describe("installDesign", () => {
  test("writes the file and stamps its origin", async () => {
    const result = await installDesign(doc, root);
    assert.equal(result.path, "DESIGN.md");
    assert.equal(result.overwrote, false);

    const written = await readFile(join(root, "DESIGN.md"), "utf8");
    assert.ok(written.includes("frontend-design-mcp: source=getdesign:stripe"));
  });

  test("a later session recovers the origin and sees an unmodified file", async () => {
    await installDesign(doc, root);
    const found = (await findProjectDesign(root))!;
    assert.equal(found.source, "getdesign:stripe");
    assert.equal(found.modifiedSinceInstall, false);
  });

  test("detects that the installed file was edited afterwards", async () => {
    await installDesign(doc, root);
    const path = join(root, "DESIGN.md");
    const edited = (await readFile(path, "utf8")).replace("#533afd", "#000000");
    await writeFile(path, edited, "utf8");

    const found = (await findProjectDesign(root))!;
    assert.equal(found.modifiedSinceInstall, true);
  });

  test("still recognizes markers written under the old project name", async () => {
    // Files installed before the rename carry `getdesign-mcp:`; orphaning them would turn a
    // known-origin DESIGN.md back into an unknown one.
    const legacy = [
      doc.content.trimEnd(),
      "",
      `<!-- getdesign-mcp: source=getdesign:stripe sha256=${"0".repeat(64)} installed=2026-01-01T00:00:00.000Z -->`,
      "",
    ].join("\n");
    await writeFile(join(root, "DESIGN.md"), legacy, "utf8");
    const found = (await findProjectDesign(root))!;
    assert.equal(found.source, "getdesign:stripe");
  });

  test("refuses to overwrite unless asked", async () => {
    await installDesign(doc, root);
    await assert.rejects(() => installDesign(doc, root), /already exists/);
    const second = await installDesign(doc, root, "DESIGN.md", true);
    assert.equal(second.overwrote, true);
  });

  test("refuses to escape the project root", async () => {
    await assert.rejects(() => installDesign(doc, root, "../escaped.md"), /escapes it/);
    await assert.rejects(() => installDesign(doc, root, "a/../../escaped.md"), /escapes it/);
    await assert.rejects(() => installDesign(doc, root, "/tmp/absolute.md"), /relative/);
  });

  test("allows a filename that merely starts with dots", async () => {
    // The guard compares path segments now; a plain startsWith("..") rejected this valid name.
    const result = await installDesign(doc, root, "..hidden.md");
    assert.equal(result.path, "..hidden.md");
  });

  test("creates missing parent directories", async () => {
    // docs/ and .claude/ are among the locations findProjectDesign itself searches, so a
    // nested target is expected rather than exotic.
    const result = await installDesign(doc, root, "docs/DESIGN.md");
    assert.equal(result.path, "docs/DESIGN.md");
    const found = await findProjectDesign(root);
    assert.equal(found?.path, "docs/DESIGN.md");
  });
});
