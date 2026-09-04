/** Shared types for the unified DESIGN.md catalog. */

/** Which catalog a design came from. Also the prefix of every design id. */
export type ProviderId = "getdesign" | "designmd.app" | "designmd.ai";

/** A design system as it appears in search results. Cheap: metadata only. */
export interface DesignSummary {
  /** Namespaced, globally unique: "getdesign:stripe", "designmd.ai:chef/genesis". */
  id: string;
  provider: ProviderId;
  /** Provider-local identifier. */
  slug: string;
  name: string;
  description?: string;
  /** Human-facing page for this design. */
  url?: string;
  tags?: string[];
  /** Representative colors, when the provider gives them without a full fetch. */
  previewColors?: string[];
  /** False when content sits behind a paywall or a missing API key. */
  fetchable: boolean;
  /** Present when fetchable is false: why, and what to do about it. */
  gatedReason?: string;
  /** Set by the registry when merging: 1 = most trusted source. See PROVIDER_TIERS. */
  tier?: number;
}

/**
 * Preference order when several catalogs answer the same query, best first.
 *
 * The ordering tracks how much a result can be trusted and whether it can actually be
 * delivered:
 *   1 getdesign.md  - curated brand extractions, sha256-signed, integrity-verified on fetch
 *   2 designmd.ai   - community uploads of variable quality; content needs an API key
 *   3 designmd.app  - no download endpoint exists, so a hit is only ever a link
 */
export const PROVIDER_TIERS: Record<ProviderId, number> = {
  getdesign: 1,
  "designmd.ai": 2,
  "designmd.app": 3,
};

/** A fetched DESIGN.md, plus what we could learn about it. */
export interface DesignDocument {
  id: string;
  provider: ProviderId;
  slug: string;
  /** Raw markdown, exactly as served. */
  content: string;
  /** "frontmatter" = YAML tokens present; "prose" = Stitch-style, tokens must be extracted. */
  variant: "frontmatter" | "prose";
  url?: string;
  /** sha256 of the bytes we received. Present regardless of whether it was checked. */
  sha256?: string;
  /** True only when a digest published by the provider actually matched. */
  verified?: boolean;
}

/** Design tokens, normalized across both file variants. */
export interface DesignTokens {
  id: string;
  /** "frontmatter" when parsed from YAML; "extracted" when regexed out of prose. */
  source: "frontmatter" | "extracted";
  /** True when the source could not supply everything (prose files). */
  partial: boolean;
  colors: Record<string, string>;
  typography?: unknown;
  spacing?: unknown;
  rounded?: unknown;
  components?: unknown;
  /** Set when partial: what a caller should not expect to find here. */
  note?: string;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  tags?: string[];
  /** Search document text, not just names. Costs a first-call cache warm; only getdesign.md uses it. */
  deep?: boolean;
}

/** What a provider can do right now, given the current config. */
export interface ProviderCapabilities {
  id: ProviderId;
  /** Human name for reports. */
  label: string;
  enabled: boolean;
  canSearch: boolean;
  canFetchContent: boolean;
  /** Set when a capability is off: how the user turns it on. */
  note?: string;
  /** Only getdesign.md publishes per-file digests. */
  verifiesIntegrity: boolean;
}

/**
 * One catalog behind one interface. Every method may throw; the registry
 * converts a throw into a degraded result rather than a failed tool call.
 */
export interface Provider {
  readonly id: ProviderId;
  capabilities(): ProviderCapabilities;
  search(opts: SearchOptions): Promise<DesignSummary[]>;
  /** Reject with a clear message when the design is gated. */
  get(slug: string): Promise<DesignDocument>;
}
