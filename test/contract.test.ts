/**
 * Live contract tests. These hit the real catalogs, so they are opt-in:
 *   GETDESIGN_LIVE=1 npm test
 *
 * They exist because none of the three providers publishes an API contract. If a site changes
 * a response shape or an endpoint, this is where it should fail loudly instead of at a user's
 * terminal.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { CACHE_DIR, cachedGet } from "../dist/cache.js";
import { extractTokens, sliceSection } from "../dist/markdown.js";
import { DesignMdAiProvider } from "../dist/providers/designmdai.js";
import { DesignMdAppProvider } from "../dist/providers/designmdapp.js";
import { GetDesignMdProvider } from "../dist/providers/getdesignmd.js";
import { Registry } from "../dist/providers/index.js";

const live = Boolean(process.env.GETDESIGN_LIVE);
const opts = { skip: live ? false : "set GETDESIGN_LIVE=1 to run live contract tests" };

describe("getdesign.md contract", () => {
  test("the signed index still lists a full catalog", opts, async () => {
    const digests = await new GetDesignMdProvider().digests();
    assert.ok(digests.size >= 70, `expected >=70 signed entries, got ${digests.size}`);
  });

  test("content still arrives as markdown and matches its published digest", opts, async () => {
    const doc = await new GetDesignMdProvider().get("stripe");
    assert.equal(doc.variant, "frontmatter");
    const actual = createHash("sha256").update(doc.content, "utf8").digest("hex");
    assert.equal(doc.sha256, actual);
    // sha256 is set whether or not anything was checked, so assert the flag that actually
    // means "a published digest matched" - otherwise a catalog that dropped its digests
    // would silently stop being verified while this test kept passing.
    assert.equal(doc.verified, true, "the catalog should still publish a matching digest");
  });

  test("frontmatter tokens still parse to named roles", opts, async () => {
    const doc = await new GetDesignMdProvider().get("stripe");
    const tokens = extractTokens(doc.id, doc.content);
    assert.equal(tokens.partial, false);
    assert.match(tokens.colors.primary, /^#[0-9a-f]{6}$/i);
  });

  test("a section slice is a small fraction of the document", opts, async () => {
    const doc = await new GetDesignMdProvider().get("stripe");
    const slice = sliceSection(doc.content, "Colors");
    assert.ok(slice, "Colors section should exist");
    assert.ok(slice!.length < doc.content.length * 0.25);
  });

  test("a gated slug fails with an explanation, not a raw 404", opts, async () => {
    await assert.rejects(
      () => new GetDesignMdProvider().get("aave"),
      /Catalog Pass|not in getdesign\.md/,
    );
  });

  test("a 404 is not masked by a stale cache entry", opts, async () => {
    // Regression: the offline fallback used to swallow every error, so a design removed
    // upstream would keep being served from cache forever.
    const dead = "https://getdesign.md/design-md/definitely-not-a-real-brand/DESIGN.md";
    const key = createHash("sha256").update(dead).digest("hex").slice(0, 32);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      join(CACHE_DIR, `${key}.json`),
      JSON.stringify({ url: dead, body: "STALE", fetchedAt: Date.now() }),
      "utf8",
    );
    await assert.rejects(() => cachedGet(dead), /404/);
  });

  test("force bypasses the ETag so the origin must send a body", opts, async () => {
    // Regression: force used to set maxAge 0 but still send If-None-Match, so the server
    // answered 304 and the caller got back the exact entry it was trying to bypass.
    const url = "https://getdesign.md/.well-known/agent-skills/index.json";
    await cachedGet(url);
    const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
    const path = join(CACHE_DIR, `${key}.json`);
    const entry = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...entry, body: '{"skills":[]}' }), "utf8");

    const forced = JSON.parse(await cachedGet(url, { force: true }));
    assert.ok(forced.skills.length > 0, "force returned the poisoned cache entry");
  });
});

describe("designmd.ai contract", () => {
  test("keyless search still returns results", opts, async () => {
    const results = await new DesignMdAiProvider().search({ query: "dark fintech", limit: 3 });
    assert.ok(results.length > 0, "expected keyless search to return hits");
    assert.ok(results.every((r) => r.id.startsWith("designmd.ai:")));
  });

  test("results are marked unfetchable when no key is configured", opts, async () => {
    const results = await new DesignMdAiProvider().search({ query: "saas", limit: 3 });
    // Guard against a vacuous pass: every() is true for an empty array.
    assert.ok(results.length > 0, "expected hits to assert against");
    assert.ok(results.every((r) => r.fetchable === false));
    assert.ok(results.every((r) => r.gatedReason?.includes("DESIGNMD_API_KEY")));
  });

  test("search actually filters on the query", opts, async () => {
    // Regression guard. The wire parameter is "q"; sending "query" is silently ignored and the
    // API answers every search with the same trending filler. A nonsense query must return
    // nothing - that is the cheapest way to prove the parameter is being read.
    const nonsense = await new DesignMdAiProvider().search({
      query: "zzzznonsensequery",
      limit: 5,
    });
    assert.equal(nonsense.length, 0, "a nonsense query must not return results");

    const real = await new DesignMdAiProvider().search({ query: "dark fintech", limit: 5 });
    assert.ok(real.length > 0, "a real query must return results");
  });

  test("different queries return different results", opts, async () => {
    const provider = new DesignMdAiProvider();
    const a = await provider.search({ query: "notion", limit: 5 });
    const b = await provider.search({ query: "dark fintech", limit: 5 });
    const overlap = a.filter((x) => b.some((y) => y.id === x.id)).length;
    assert.ok(
      overlap < Math.min(a.length, b.length),
      "two unrelated queries returned the same set",
    );
  });

  test("the tag taxonomy is still open", opts, async () => {
    const tags = await new DesignMdAiProvider().tags();
    assert.ok(tags.length > 5, `expected a tag list, got ${tags.length}`);
  });

  test("fetching without a key explains how to get one", opts, async () => {
    await assert.rejects(() => new DesignMdAiProvider().get("chef/genesis"), /DESIGNMD_API_KEY/);
  });
});

describe("designmd.app contract", () => {
  test("search still returns results with parsed tags", opts, async () => {
    const results = await new DesignMdAppProvider().search({ query: "fintech", limit: 3 });
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.fetchable === false));
  });
});

describe("registry", () => {
  test("search fans out across providers and merges", opts, async () => {
    const outcome = await new Registry({}).search({ query: "fintech", limit: 3 });
    const providers = new Set(outcome.results.map((r) => r.provider));
    assert.ok(
      providers.size >= 2,
      `expected hits from 2+ providers, saw ${[...providers].join(", ")}`,
    );
  });

  test("fetchable results sort ahead of gated ones", opts, async () => {
    const outcome = await new Registry({}).search({ query: "stripe", limit: 5 });
    const firstGated = outcome.results.findIndex((r) => !r.fetchable);
    const lastFetchable = outcome.results.map((r) => r.fetchable).lastIndexOf(true);
    // Assert the preconditions rather than skipping: a query returning no gated or no fetchable
    // results would let this test pass without ever checking the ordering.
    assert.notEqual(firstGated, -1, "expected at least one gated result to order against");
    assert.notEqual(lastFetchable, -1, "expected at least one fetchable result to order against");
    assert.ok(lastFetchable < firstGated, "fetchable results must sort first");
  });

  test("results are tiered getdesign > designmd.ai > designmd.app", opts, async () => {
    const outcome = await new Registry({}).search({ query: "notion", limit: 6 });
    const tiers = outcome.results.map((r) => r.tier ?? 99);
    assert.deepEqual(
      tiers,
      [...tiers].sort((a, b) => a - b),
      `tiers out of order: ${tiers.join(",")}`,
    );
    assert.equal(
      outcome.results[0]?.provider,
      "getdesign",
      "a brand query should lead with getdesign.md",
    );
  });

  test("fetchability outranks tier", opts, async () => {
    const outcome = await new Registry({}).search({ query: "notion", limit: 6 });
    const lastFetchable = outcome.results.map((r) => r.fetchable).lastIndexOf(true);
    const firstGated = outcome.results.findIndex((r) => !r.fetchable);
    assert.notEqual(lastFetchable, -1, "expected at least one fetchable result to order against");
    assert.notEqual(firstGated, -1, "expected at least one gated result to order against");
    assert.ok(lastFetchable < firstGated, "a deliverable result must outrank a gated one");
  });

  test("fetchable entries are not crowded out of a provider's own result slice", opts, async () => {
    // Regression: a -0.5 penalty only broke ties, so gated slug matches outscored open entries
    // that matched on description - and the slice happens inside the provider, discarding them
    // before the registry's fetchability sort could ever see them.
    const hits = await new GetDesignMdProvider().search({ query: "an", limit: 10 });
    const fetchable = hits.filter((h) => h.fetchable).length;
    assert.ok(fetchable >= 8, `expected mostly fetchable results, got ${fetchable}/${hits.length}`);
  });

  test("a bare id is rejected with guidance", () => {
    assert.throws(() => new Registry({}).parseId("stripe"), /namespaced/);
  });

  test("an id with a slash in the slug still parses", () => {
    const { provider, slug } = new Registry({}).parseId("designmd.ai:chef/genesis");
    assert.equal(provider.id, "designmd.ai");
    assert.equal(slug, "chef/genesis");
  });
});
