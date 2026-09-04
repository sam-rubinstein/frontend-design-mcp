/**
 * designmd.app - a themed-template library (plus LatAm brand systems) by ft.ia.br.
 *
 * Search only. Probing found no raw-content endpoint: /api/design/<slug>, /api/library/<slug>
 * and /library/<slug>/DESIGN.md all 404, and /api/search returns metadata with no content
 * field. So results carry fetchable:false and point the caller at the page.
 */
import { httpGetJson } from "../http.js";
import { asString } from "../shape.js";
import type {
  DesignDocument,
  DesignSummary,
  Provider,
  ProviderCapabilities,
  SearchOptions,
} from "../types.js";

const SEARCH_URL = "https://designmd.app/api/search";

/** Shapes as they arrive on the wire: unvalidated, so every field is unknown until normalized. */
interface AppHit {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  type?: unknown;
  use_case?: unknown;
  era?: unknown;
  style_type?: unknown;
  /** A JSON-encoded array delivered in a string field, not an array. */
  keywords?: unknown;
}

/** keywords arrives JSON-encoded in a string; style_type is comma separated. Both become tags. */
function tagsFrom(hit: AppHit): string[] {
  const tags: string[] = [];
  const keywords = asString(hit.keywords);
  if (keywords) {
    try {
      const parsed = JSON.parse(keywords);
      if (Array.isArray(parsed)) {
        tags.push(...parsed.filter((t): t is string => typeof t === "string"));
      }
    } catch {
      // Malformed keywords are not worth failing a search over.
    }
  }
  // Guarded on type, not truthiness: a numeric style_type is truthy and then throws on .split.
  const styleType = asString(hit.style_type);
  if (styleType) {
    tags.push(
      ...styleType
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
    const hits = (Array.isArray(res.data) ? res.data : []).filter(
      (hit): hit is AppHit => typeof hit === "object" && hit !== null,
    );

    // Filter before slicing: truncating first would drop valid hits sitting past the cut
    // whenever the API returns entries without a slug.
    return hits
      .filter((hit) => Boolean(asString(hit.slug)))
      .slice(0, opts.limit ?? 10)
      .flatMap((hit) => {
        const slug = asString(hit.slug);
        if (!slug) return [];
        const useCase = asString(hit.use_case);
        const summary: DesignSummary = {
          id: `${this.id}:${slug}`,
          provider: this.id,
          slug,
          name: asString(hit.title) ?? slug,
          description: [
            asString(hit.description),
            useCase && `Use case: ${useCase}`,
            asString(hit.era),
          ]
            .filter(Boolean)
            .join(" - "),
          url: `https://designmd.app/library/${slug}`,
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
