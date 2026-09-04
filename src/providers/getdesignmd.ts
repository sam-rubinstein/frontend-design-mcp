/**
 * getdesign.md - VoltAgent's brand-extraction catalog.
 *
 * Two tiers live here:
 *   open        - listed in the signed agent-skills index, served as text/markdown, sha256 published
 *   catalog-pass- discoverable via sitemap only; /DESIGN.md returns 404 behind the paywall
 * Both are searchable; only the first is fetchable.
 */
import { cachedGet, sha256Hex } from "../cache.js";
import { detectVariant } from "../markdown.js";
import type {
  DesignDocument,
  DesignSummary,
  Provider,
  ProviderCapabilities,
  SearchOptions,
} from "../types.js";

const INDEX_URL = "https://getdesign.md/.well-known/agent-skills/index.json";
const SITEMAP_URL = "https://getdesign.md/sitemap.xml";
const INDEX_TTL_MS = 60 * 60 * 1000; // new brands appear without a release
const SITEMAP_TTL_MS = 24 * 60 * 60 * 1000;
// Design documents change rarely, and the index digest catches it when they do. A short window
// lets repeated calls in one session skip the revalidation round trip entirely.
const CONTENT_TTL_MS = 5 * 60 * 1000;

interface SkillEntry {
  name: string;
  type: string;
  description: string;
  url: string;
  /** "sha256-<hex>" */
  sha256?: string;
}

interface SkillIndex {
  skills?: SkillEntry[];
}

/** "claude/DESIGN" -> "claude" */
function slugFromName(name: string): string {
  return name.replace(/\/DESIGN$/, "");
}

function digestFromEntry(entry: SkillEntry): string | undefined {
  return entry.sha256?.replace(/^sha256-/, "");
}

export class GetDesignMdProvider implements Provider {
  readonly id = "getdesign" as const;

  private indexCache?: { map: Map<string, SkillEntry>; at: number };
  private corpusCache?: { map: Map<string, string>; at: number };

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      label: "getdesign.md",
      enabled: true,
      canSearch: true,
      canFetchContent: true,
      verifiesIntegrity: true,
    };
  }

  /**
   * The signed catalog index.
   *
   * The in-memory copy expires on the same clock as the disk cache. Without that it would
   * outlive the TTL for the whole life of the process - and an MCP server runs for days, so a
   * brand added upstream would never appear.
   */
  private async index(force = false): Promise<Map<string, SkillEntry>> {
    const fresh = this.indexCache && Date.now() - this.indexCache.at < INDEX_TTL_MS;
    if (fresh && !force) return this.indexCache!.map;

    const raw = await cachedGet(INDEX_URL, force ? { force: true } : { maxAgeMs: INDEX_TTL_MS });
    const parsed = JSON.parse(raw) as SkillIndex;
    const map = new Map<string, SkillEntry>();
    const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
    for (const raw of skills) {
      // Skip malformed entries rather than letting one bad row poison the whole catalog, and
      // normalize the optional fields: a non-string sha256 would throw inside digestFromEntry,
      // and a non-string description would throw when the search result is trimmed.
      if (typeof raw?.name !== "string" || typeof raw?.url !== "string") continue;
      map.set(slugFromName(raw.name), {
        name: raw.name,
        url: raw.url,
        type: typeof raw.type === "string" ? raw.type : "design-system",
        description: typeof raw.description === "string" ? raw.description : "",
        sha256: typeof raw.sha256 === "string" ? raw.sha256 : undefined,
      });
    }
    this.indexCache = { map, at: Date.now() };
    return map;
  }

  /** Slugs the site lists publicly but does not serve as markdown. */
  private async gatedSlugs(): Promise<string[]> {
    try {
      const xml = await cachedGet(SITEMAP_URL, { maxAgeMs: SITEMAP_TTL_MS });
      const slugs = new Set<string>();
      for (const m of xml.matchAll(/<loc>https:\/\/getdesign\.md\/design-md\/([^</]+)<\/loc>/g)) {
        slugs.add(decodeURIComponent(m[1]));
      }
      return [...slugs];
    } catch {
      return []; // discovery is a bonus; never fail search over it
    }
  }

  /**
   * Full text of every catalog entry, for style queries.
   *
   * The index descriptions are boilerplate ("DESIGN.md for claude - design tokens and component
   * rules."), so a shallow search here can only ever match brand names. Deep search fetches the
   * documents themselves. The first call warms the disk cache; later ones revalidate with ETags.
   */
  private async corpus(): Promise<Map<string, string>> {
    // Expires on the same clock as the index; a latched copy would rank deep searches on
    // document text that is days old.
    if (this.corpusCache && Date.now() - this.corpusCache.at < INDEX_TTL_MS) {
      return this.corpusCache.map;
    }
    const index = await this.index();
    const entries = [...index.entries()];
    const out = new Map<string, string>();

    const CONCURRENCY = 6;
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      const fetched = await Promise.allSettled(
        batch.map(
          async ([slug, entry]) =>
            [slug, await cachedGet(entry.url, { maxAgeMs: CONTENT_TTL_MS })] as const,
        ),
      );
      for (const result of fetched) {
        if (result.status === "fulfilled") out.set(result.value[0], result.value[1].toLowerCase());
      }
    }

    this.corpusCache = { map: out, at: Date.now() };
    return out;
  }

  async search(opts: SearchOptions & { deep?: boolean }): Promise<DesignSummary[]> {
    const index = await this.index();
    const terms = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: { summary: DesignSummary; score: number }[] = [];

    // Style queries ("warm editorial", "dark fintech") can only match document text.
    const corpus = opts.deep ? await this.corpus() : undefined;

    for (const [slug, entry] of index) {
      const haystack = `${slug} ${entry.description ?? ""}`.toLowerCase();
      const body = corpus?.get(slug);
      const score = terms.reduce(
        (acc, t) =>
          acc +
          (slug.toLowerCase().includes(t) ? 3 : 0) +
          (haystack.includes(t) ? 1 : 0) +
          (body?.includes(t) ? 1 : 0),
        0,
      );
      if (terms.length === 0 || score > 0) {
        scored.push({
          score,
          summary: {
            id: `${this.id}:${slug}`,
            provider: this.id,
            slug,
            name: slug,
            description: entry.description,
            url: `https://getdesign.md/${slug}/design-md`,
            fetchable: true,
          },
        });
      }
    }

    // Gated entries stay visible so the agent learns they exist, with the reason attached.
    const open = new Set(index.keys());
    for (const slug of await this.gatedSlugs()) {
      if (open.has(slug)) continue;
      const score = terms.reduce((acc, t) => acc + (slug.toLowerCase().includes(t) ? 3 : 0), 0);
      if (terms.length > 0 && score === 0) continue;
      scored.push({
        score,
        summary: {
          id: `${this.id}:${slug}`,
          provider: this.id,
          slug,
          name: slug,
          url: `https://getdesign.md/design-md/${slug}`,
          fetchable: false,
          gatedReason:
            "Listed on getdesign.md but not in the public index; the DESIGN.md needs a Catalog Pass. Open the URL to view it.",
        },
      });
    }

    // Partition rather than penalize. A score nudge cannot express "always below": a gated
    // slug match outscores an open entry that matched only its boilerplate description, and
    // because the slice happens here, those open entries would be dropped before the registry
    // ever saw them.
    scored.sort((a, b) => {
      if (a.summary.fetchable !== b.summary.fetchable) {
        return Number(b.summary.fetchable) - Number(a.summary.fetchable);
      }
      return b.score - a.score;
    });
    return scored.slice(0, opts.limit ?? 10).map((s) => s.summary);
  }

  async get(slug: string): Promise<DesignDocument> {
    const index = await this.index();
    const entry = index.get(slug);
    if (!entry) {
      throw new Error(
        `"${slug}" is not in getdesign.md's public index. It may require a Catalog Pass ` +
          `(see https://getdesign.md/design-md/${slug}), or the slug may be wrong - try search_designs.`,
      );
    }

    let content = await cachedGet(entry.url, { maxAgeMs: CONTENT_TTL_MS });
    let actual = sha256Hex(content);
    let expected = digestFromEntry(entry);

    // A mismatch usually means something is merely stale, not tampered: either the cached index
    // still carries a previous digest, or the cached document is older than a republish. Refresh
    // BOTH sides before crying tamper - refreshing only the index leaves a document served from
    // the content TTL disagreeing with a freshly-read digest, which turns a routine upstream
    // update into a security error.
    if (expected && expected !== actual) {
      const refreshed = (await this.index(true)).get(slug);
      expected = refreshed ? digestFromEntry(refreshed) : undefined;
      if (expected && expected !== actual) {
        content = await cachedGet(entry.url, { force: true });
        actual = sha256Hex(content);
      }
    }

    if (expected && expected !== actual) {
      throw new Error(
        `Integrity check failed for ${slug}: the index publishes sha256 ${expected} but the ` +
          `downloaded file hashes to ${actual}. Refusing to return possibly-tampered content.`,
      );
    }

    return {
      id: `${this.id}:${slug}`,
      provider: this.id,
      slug,
      content,
      variant: detectVariant(content),
      url: entry.url,
      sha256: actual,
      // Only true when the index actually published a digest and it matched.
      verified: Boolean(expected) && expected === actual,
    };
  }

  /** Slug -> published digest, for check_updates. */
  async digests(): Promise<Map<string, string>> {
    const index = await this.index();
    const out = new Map<string, string>();
    for (const [slug, entry] of index) {
      const d = digestFromEntry(entry);
      if (d) out.set(slug, d);
    }
    return out;
  }
}
