/**
 * designmd.app - a themed-template library (plus LatAm brand systems) by ft.ia.br.
 *
 * Search only. Probing found no raw-content endpoint: /api/design/<slug>, /api/library/<slug>
 * and /library/<slug>/DESIGN.md all 404, and /api/search returns metadata with no content
 * field. So results carry fetchable:false and point the caller at the page.
 */
import { httpGetJson } from "../http.js";
import type {
  DesignDocument,
  DesignSummary,
  Provider,
  ProviderCapabilities,
  SearchOptions,
} from "../types.js";

const SEARCH_URL = "https://designmd.app/api/search";

interface AppHit {
  id?: number;
  slug?: string;
  title?: string;
  description?: string;
  type?: string;
  use_case?: string;
  era?: string;
  style_type?: string;
  /** A JSON-encoded array delivered in a string field, not an array. */
  keywords?: string;
}

/** keywords arrives JSON-encoded in a string; style_type is comma separated. Both become tags. */
function tagsFrom(hit: AppHit): string[] {
  const tags: string[] = [];
  if (hit.keywords) {
    try {
      const parsed = JSON.parse(hit.keywords);
      if (Array.isArray(parsed)) {
        tags.push(...parsed.filter((t): t is string => typeof t === "string"));
      }
    } catch {
      // Malformed keywords are not worth failing a search over.
    }
  }
  if (hit.style_type) {
    tags.push(
      ...hit.style_type
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return [...new Set(tags)];
}

export class DesignMdAppProvider implements Provider {
  readonly id = "designmd.app" as const;

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      label: "designmd.app",
      enabled: true,
      canSearch: true,
      canFetchContent: false,
      note: "Search-and-link only: this site publishes no raw DESIGN.md endpoint. Results link to the page.",
      verifiesIntegrity: false,
    };
  }

  async search(opts: SearchOptions): Promise<DesignSummary[]> {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(opts.query)}`;
    const res = await httpGetJson<{ data?: AppHit[] }>(url);
    const hits = res.data ?? [];

    // Filter before slicing: truncating first would drop valid hits sitting past the cut
    // whenever the API returns entries without a slug.
    return hits
      .filter((hit) => Boolean(hit.slug))
      .slice(0, opts.limit ?? 10)
      .flatMap((hit) => {
        if (!hit.slug) return [];
        const summary: DesignSummary = {
          id: `${this.id}:${hit.slug}`,
          provider: this.id,
          slug: hit.slug,
          name: hit.title ?? hit.slug,
          description: [hit.description, hit.use_case && `Use case: ${hit.use_case}`, hit.era]
            .filter(Boolean)
            .join(" - "),
          url: `https://designmd.app/library/${hit.slug}`,
          tags: tagsFrom(hit),
          fetchable: false,
          gatedReason:
            "designmd.app publishes no raw DESIGN.md endpoint, so the content cannot be fetched " +
            "automatically. Open the URL to copy it.",
        };
        return [summary];
      });
  }

  async get(slug: string): Promise<DesignDocument> {
    throw new Error(
      `designmd.app does not serve DESIGN.md content over HTTP, so "${slug}" cannot be fetched. ` +
        `Open https://designmd.app/library/${slug} to copy it manually.`,
    );
  }
}
