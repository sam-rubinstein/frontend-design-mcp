/**
 * designmd.ai - community design-kit catalog. designmd.co is the same backend.
 *
 * Search and tags are open; raw content returns 401 without a key. The key gates the
 * capability, never the provider: search keeps working so the agent still sees what exists.
 *
 * Endpoints were read from the MIT-licensed designmd-mcp@0.2.1 package (dist/api-client.js).
 * There is no published API contract, so every shape here is parsed defensively.
 */
import { HttpError, httpGet, httpGetJson } from "../http.js";
import { detectVariant } from "../markdown.js";
import { asString, asStringArray } from "../shape.js";
import type {
  DesignDocument,
  DesignSummary,
  Provider,
  ProviderCapabilities,
  SearchOptions,
} from "../types.js";

const API_BASE = "https://designmd.ai/api/v1";
const SIGNUP_URL = "https://designmd.ai/api-keys";

/** Shapes as they arrive on the wire: unvalidated, so every field is unknown until normalized. */
interface KitHit {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  url?: unknown;
  author?: { username?: unknown };
  preview_colors?: unknown;
  tags?: unknown;
  license?: unknown;
  download_count?: unknown;
}

export class DesignMdAiProvider implements Provider {
  readonly id = "designmd.ai" as const;

  constructor(private readonly apiKey?: string) {}

  private get hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      label: "designmd.ai (also serves designmd.co)",
      enabled: true,
      canSearch: true,
      canFetchContent: this.hasKey,
      note: this.hasKey
        ? undefined
        : `Search works without a key. To fetch content, set DESIGNMD_API_KEY - free key at ${SIGNUP_URL}.`,
      verifiesIntegrity: false,
    };
  }

  async search(opts: SearchOptions): Promise<DesignSummary[]> {
    // The wire parameter is "q", not "query". Sending "query" is silently ignored and the API
    // answers with trending filler - identical results for every search, including nonsense.
    // Confirmed against designmd-mcp's own client: params.set("q", query).
    const params = new URLSearchParams({
      q: opts.query,
      limit: String(Math.min(opts.limit ?? 10, 20)),
    });
    // Tags are one comma-joined parameter, not repeated ones.
    if (opts.tags?.length) params.set("tags", opts.tags.join(","));

    const res = await httpGetJson<{ data?: KitHit[] }>(`${API_BASE}/kits?${params}`, {
      headers: this.authHeaders(),
    });

    const hits = (Array.isArray(res.data) ? res.data : []).filter(
      (hit): hit is KitHit => typeof hit === "object" && hit !== null,
    );
    return hits.flatMap((hit) => {
      // Every field is normalized at the boundary. The two required ones drop the row; the
      // optional ones degrade to undefined rather than throwing wherever they are consumed.
      const username = asString(hit.author?.username);
      const kit = asString(hit.slug);
      if (!kit || !username) return [];
      const slug = `${username}/${kit}`;
      const summary: DesignSummary = {
        id: `${this.id}:${slug}`,
        provider: this.id,
        slug,
        name: asString(hit.name) ?? kit,
        description: asString(hit.description),
        url: asString(hit.url) ?? `https://designmd.ai/${slug}`,
        tags: asStringArray(hit.tags),
        previewColors: asStringArray(hit.preview_colors),
        fetchable: this.hasKey,
        gatedReason: this.hasKey
          ? undefined
          : `Content needs an API key. Set DESIGNMD_API_KEY (free at ${SIGNUP_URL}) to fetch it.`,
      };
      return [summary];
    });
  }

  /** Tag taxonomy with counts. Open endpoint, no key needed. */
  async tags(): Promise<{ name: string; count: number }[]> {
    const res = await httpGetJson<{ data?: { name?: string; count?: number }[] }>(
      `${API_BASE}/tags`,
    );
    const rows = Array.isArray(res.data) ? res.data : [];
    return rows.flatMap((t) =>
      typeof t?.name === "string" ? [{ name: t.name, count: t.count ?? 0 }] : [],
    );
  }

  async get(slug: string): Promise<DesignDocument> {
    if (!this.hasKey) {
      throw new Error(
        `designmd.ai needs an API key to return content. Set DESIGNMD_API_KEY in this MCP ` +
          `server's environment - a free key is at ${SIGNUP_URL}. Search still works without one.`,
      );
    }
    const parts = slug.split("/");
    const [username, kit] = parts;
    // Exactly two segments. Silently dropping extras would fetch one kit and label it another.
    if (parts.length !== 2 || !username || !kit) {
      throw new Error(`designmd.ai ids look like "username/slug"; got "${slug}".`);
    }

    const url = `${API_BASE}/kits/${encodeURIComponent(username)}/${encodeURIComponent(kit)}/raw`;
    let content = "";
    try {
      const res = await httpGet(url, { headers: { ...this.authHeaders(), accept: "*/*" } });
      const body = res.body.trim();
      // The endpoint may hand back raw markdown or a JSON envelope; accept either.
      if (body.startsWith("{")) {
        const parsed: unknown = JSON.parse(body);
        const envelope =
          typeof parsed === "object" && parsed !== null
            ? (parsed as { content?: unknown; data?: { content?: unknown } })
            : {};
        const candidate = envelope.content ?? envelope.data?.content;
        content = typeof candidate === "string" ? candidate : "";
      } else {
        content = res.body;
      }
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        throw new Error(
          `designmd.ai rejected the API key (401). Check DESIGNMD_API_KEY; keys start with "dk_".`,
        );
      }
      throw err;
    }

    if (!content.trim()) {
      throw new Error(`designmd.ai returned no content for "${slug}".`);
    }

    return {
      id: `${this.id}:${slug}`,
      provider: this.id,
      slug,
      content,
      variant: detectVariant(content),
      url: `https://designmd.ai/${slug}`,
    };
  }
}
