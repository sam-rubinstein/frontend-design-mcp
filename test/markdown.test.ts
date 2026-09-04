/** Parser tests against real files pulled from getdesign.md, both variants. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  detectVariant,
  extractColorsFromProse,
  extractTitle,
  extractTokens,
  listSections,
  parseFrontmatter,
  sliceSection,
} from "../dist/markdown.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", `${name}.md`), "utf8");

const stripe = fixture("stripe"); // frontmatter variant
const tesla = fixture("tesla"); // prose variant
const nike = fixture("nike"); // frontmatter with a YAML block scalar
const supabase = fixture("supabase"); // frontmatter whose description holds an unquoted colon

describe("variant detection", () => {
  test("recognizes a frontmatter file", () => {
    assert.equal(detectVariant(stripe), "frontmatter");
  });

  test("recognizes a prose file", () => {
    assert.equal(detectVariant(tesla), "prose");
  });
});

describe("frontmatter parsing", () => {
  test("reads the documented top-level keys", () => {
    const fm = parseFrontmatter(stripe)!;
    for (const key of [
      "version",
      "name",
      "description",
      "colors",
      "typography",
      "spacing",
      "rounded",
      "components",
    ]) {
      assert.ok(key in fm, `expected key ${key}`);
    }
  });

  test("handles a block-scalar description without truncating it", () => {
    const fm = parseFrontmatter(nike)!;
    assert.equal(typeof fm.description, "string");
    assert.ok((fm.description as string).length > 40);
  });

  test("returns undefined for a file with no frontmatter", () => {
    assert.equal(parseFrontmatter(tesla), undefined);
  });

  test("recovers a block whose description contains an unquoted colon", () => {
    // Six catalog entries ship a prose description with an inner ": ", which YAML reads as a
    // nested mapping. Rejecting the block would throw away the colors along with it.
    const fm = parseFrontmatter(supabase);
    assert.ok(fm, "expected recovery, not undefined");
    assert.ok(fm!.colors, "colors must survive the recovery");
  });
});

describe("token extraction", () => {
  test("pulls named colors from frontmatter and marks them complete", () => {
    const tokens = extractTokens("getdesign:stripe", stripe);
    assert.equal(tokens.source, "frontmatter");
    assert.equal(tokens.partial, false);
    assert.equal(tokens.colors.primary, "#533afd");
  });

  test("falls back to regex on prose files and flags the result partial", () => {
    const tokens = extractTokens("getdesign:tesla", tesla);
    assert.equal(tokens.source, "extracted");
    assert.equal(tokens.partial, true);
    assert.ok(Object.keys(tokens.colors).length > 0, "expected some colors");
    assert.ok(tokens.note, "partial results must explain what is missing");
  });

  test("a recovered file reports complete, named tokens", () => {
    const t = extractTokens("getdesign:supabase", supabase);
    assert.equal(t.source, "frontmatter");
    assert.equal(t.partial, false);
    assert.equal(t.colors.primary, "#3ecf8e");
  });

  test("frontmatter with no usable colors is reported partial, not complete", () => {
    const doc = ["---", "name: X", "typography:", "  body: Inter", "---", "", "## Colors"].join(
      "\n",
    );
    const t = extractTokens("id", doc);
    assert.equal(t.partial, true, "empty colors must not be reported as complete");
    assert.ok(t.note);
  });

  test("prose extraction dedupes and lowercases", () => {
    const colors = Object.values(extractColorsFromProse("#AABBCC then #aabbcc then #112233"));
    assert.deepEqual(colors, ["#aabbcc", "#112233"]);
  });
});

describe("section slicing", () => {
  test("finds a plain heading", () => {
    const slice = sliceSection(stripe, "Colors")!;
    assert.ok(slice.startsWith("## Colors"));
  });

  test("matches case-insensitively", () => {
    assert.ok(sliceSection(stripe, "colors"));
  });

  test("matches numbered headings in prose files", () => {
    const slice = sliceSection(tesla, "Visual Theme & Atmosphere");
    assert.ok(slice, "expected numbered heading to match de-numbered query");
    assert.ok(slice!.includes("Visual Theme"));
  });

  test("a section is dramatically smaller than the whole document", () => {
    const slice = sliceSection(stripe, "Colors")!;
    assert.ok(
      slice.length < stripe.length * 0.25,
      `slice was ${slice.length}b of ${stripe.length}b - slicing is the point of this server`,
    );
  });

  test("stops at the next heading rather than running to the end", () => {
    const slice = sliceSection(stripe, "Colors")!;
    const headings = slice.split("\n").filter((l) => /^##\s/.test(l));
    assert.equal(headings.length, 1);
  });

  test("returns undefined for an unknown section", () => {
    assert.equal(sliceSection(stripe, "Nonexistent Section"), undefined);
  });
});

describe("section listing", () => {
  test("lists sections with sizes", () => {
    const sections = listSections(stripe);
    assert.ok(sections.length > 3);
    assert.ok(sections.every((s) => s.length > 0));
  });

  test("ignores ## inside fenced code blocks", () => {
    const doc = ["## Real", "", "```sh", "## not a heading", "```", "", "## Also Real"].join("\n");
    assert.deepEqual(
      listSections(doc).map((s) => s.title),
      ["Real", "Also Real"],
    );
  });

  test("an unclosed fence does not swallow the rest of the document", () => {
    // Regression: fence state used to latch on, hiding every later section. Hand-written
    // DESIGN.md files carry CSS and Tailwind snippets, so this is reachable in real projects.
    const doc = ["## Alpha", "", "```sh", "echo hi", "", "## Beta", "", "## Gamma"].join("\n");
    assert.deepEqual(
      listSections(doc).map((s) => s.title),
      ["Alpha", "Beta", "Gamma"],
    );
  });
});

describe("title extraction", () => {
  test("reads the H1 of a prose file", () => {
    assert.equal(extractTitle(tesla), "Design System Inspired by Tesla");
  });
});
