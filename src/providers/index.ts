/**
 * Provider registry. Fans search out in parallel and converts a provider's failure into a
 * warning attached to the result, so one slow or broken catalog never fails a tool call.
 */

import type {
  DesignDocument,
  DesignSummary,
  Provider,
  ProviderCapabilities,
  ProviderId,
  SearchOptions,
} from "../types.js";
import { PROVIDER_TIERS } from "../types.js";
import { DesignMdAiProvider } from "./designmdai.js";
import { DesignMdAppProvider } from "./designmdapp.js";
import { GetDesignMdProvider } from "./getdesignmd.js";

export interface SearchOutcome {
  results: DesignSummary[];
  /** One line per provider that failed; empty when every provider answered. */
  warnings: string[];
}

export class Registry {
  private readonly providers: Provider[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.providers = [
      new GetDesignMdProvider(),
      new DesignMdAppProvider(),
      new DesignMdAiProvider(env.DESIGNMD_API_KEY),
    ];
  }

  capabilities(): ProviderCapabilities[] {
    return this.providers.map((p) => p.capabilities());
  }

  get(id: ProviderId): Provider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new Error(`Unknown provider "${id}".`);
    return provider;
  }

  /** "getdesign:stripe" -> provider + slug. Slugs may contain "/" (designmd.ai). */
  parseId(designId: string): { provider: Provider; slug: string } {
    const sep = designId.indexOf(":");
    if (sep === -1) {
      throw new Error(
        `Design ids are namespaced, like "getdesign:stripe" or "designmd.ai:chef/genesis". ` +
          `Got "${designId}". Use search_designs to find a valid id.`,
      );
    }
    const id = designId.slice(0, sep) as ProviderId;
    const slug = designId.slice(sep + 1);
    return { provider: this.get(id), slug };
  }

  async search(opts: SearchOptions & { providers?: ProviderId[] }): Promise<SearchOutcome> {
    const targets = opts.providers?.length
      ? this.providers.filter((p) => opts.providers!.includes(p.id))
      : this.providers;

    const settled = await Promise.allSettled(
      targets.map((p) =>
        p.search({ query: opts.query, limit: opts.limit, tags: opts.tags, deep: opts.deep }),
      ),
    );

    const results: DesignSummary[] = [];
    const warnings: string[] = [];
    /** Each provider returns its own hits best-first; remember that rank to break ties. */
    const localRank = new Map<string, number>();

    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        outcome.value.forEach((hit, position) => {
          localRank.set(hit.id, position);
          results.push({ ...hit, tier: PROVIDER_TIERS[hit.provider] });
        });
      } else {
        const reason =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        warnings.push(`${targets[i].id} did not answer: ${reason}`);
      }
    });

    // Ranking, in order of precedence:
    //   1. can we actually deliver the content? a link is worth less than a file
    //   2. provider tier - trust and integrity, see PROVIDER_TIERS
    //   3. the provider's own relevance order, preserved rather than re-scored
    // Cross-provider relevance is deliberately not invented here: the three catalogs score
    // differently and normalizing them would be fake precision.
    results.sort((a, b) => {
      if (a.fetchable !== b.fetchable) return Number(b.fetchable) - Number(a.fetchable);
      const tierDelta = (a.tier ?? 99) - (b.tier ?? 99);
      if (tierDelta !== 0) return tierDelta;
      return (localRank.get(a.id) ?? 0) - (localRank.get(b.id) ?? 0);
    });

    return { results, warnings };
  }

  async fetch(designId: string): Promise<DesignDocument> {
    const { provider, slug } = this.parseId(designId);
    return provider.get(slug);
  }
}
