# Architecture and design decisions

Background for anyone changing this code. The [README](../README.md) covers setup; this covers
why things are the way they are.

## The problem

A `DESIGN.md` averages 28KB — roughly 8,000 tokens. An agent that downloads one to answer "what's
the primary colour" spends most of a context window on prose it will never use. This server's
whole job is returning the smallest thing that answers the question.

Measured against `getdesign:stripe` (24KB) through a real MCP client. `npm run audit`
reproduces it:

| Call | ~tokens | vs whole doc |
|---|---|---|
| `get_design_tokens` with `only: "colors"` | **137** | 2% |
| `get_design_sections` | **151** | 2% |
| `get_design_tokens` | **390** | 6% |
| `get_design` with `section: "Colors"` | **624** | 10% |
| `search_designs` (5 per provider) | **866** | 14% |
| `get_design`, no section | 6,152 | 100% |

Three things keep those numbers down, and each is easy to regress:

- `typography` and `components` are summarized to key names in the default token response.
  Together they were 89% of a full dump.
- Responses are compact JSON. Pretty-printing was ~40% of every payload.
- The `gating` explanation is hoisted once per provider instead of repeated on every result row.

**Caching does not help here.** The disk cache saves bandwidth and latency; a cache hit costs the
same tokens as a miss. The only real defences against token burn are narrow calls and
`install_design` followed by reading from disk.

## Providers

| Tier | Provider | Catalog | Search | Content |
|---|---|---|---|---|
| 1 | `getdesign` | 76 brand extractions, sha256-signed | yes | yes |
| 2 | `designmd.ai` | community kits, tag taxonomy | yes | needs `DESIGNMD_API_KEY` |
| 3 | `designmd.app` | themed templates, LatAm brands | yes | no download endpoint exists |

`designmd.co` and `designmd.ai` are the same backend (`https://designmd.ai/api/v1`), not two
providers.

Merged results sort by **fetchable → tier → the provider's own relevance order**. Fetchability
outranks tier deliberately: a tier-2 file you can download beats a tier-1 entry you can't.

Cross-provider relevance is deliberately *not* normalized. The three catalogs score differently
and collapsing them into one number would be fake precision, so each provider's ranking is kept
intact within its tier. Every result carries its `tier` so the ordering is auditable.

A missing key or a paywall never hides a result. Gated designs still appear with
`fetchable: false`, and the `gating` map says what each needs.

## No published API contracts

None of the three sites documents its API.

- getdesign.md's endpoints were found through its `Link` header, which advertises
  `/.well-known/agent-skills/index.json` (an [agentskills.io](https://agentskills.io) v0.2.0
  index with a `sha256` per entry). Content is at `/design-md/<slug>/DESIGN.md`.
- designmd.ai's came from reading the MIT-licensed `designmd-mcp@0.2.1` package source.
- Its search parameter is **`q`**. Sending `query` is silently ignored and the API answers every
  search with the same trending filler, nonsense queries included.

So shapes can change without warning. `test/contract.test.ts` hits the live endpoints for exactly
this reason — it's the only thing that will tell you an upstream contract moved. Run it with
`npm run test:live`; CI runs it on a schedule rather than per-PR so an outage can't block a merge.

## Why `node:https` and not `fetch`

designmd.ai sits behind Cloudflare rules that return **403 to undici** (Node's `fetch`) while
returning **200 to `node:https` and curl** under the same declared User-Agent. Verified by
interleaved probes: curl 200 / fetch 403, three rounds, not rate limiting.

Those same rules 403 a `Mozilla/5.0` or `curl/8.0` User-Agent, so the site gates on client
identity and is friendly to clients that identify themselves. This server identifies honestly as
`frontend-design-mcp/0.1` and impersonates nothing. Don't "modernise" this back to `fetch`.

## Integrity, scoped honestly

getdesign.md publishes a `sha256` per file in its index. Every fetch is verified against it and a
mismatch is refused. All 76 entries were verified when this was built.

That digest ships from the same origin as the file, so it detects corruption and transport
tampering and pins the cache. It is **not** independent provenance — whoever controls the site
controls both. `verified` is true only when a published digest actually matched, never merely
because a hash was computed. The other two providers publish no digests.

A mismatch first forces an index refresh before throwing, because a stale cached index plus a
freshly republished file otherwise surfaces a routine upstream update as a security error.

## Two file formats

68 of getdesign.md's 76 files have YAML frontmatter with named token roles. 8 are prose-only —
`kraken`, `lamborghini`, `lovable`, `mastercard`, `spotify`, `starbucks`, `tesla`, `theverge`.
For those, `get_design_tokens` regexes hex colours out of the prose and returns `partial: true`
with positional names plus a note, never a silent empty result.

Six of the 68 — `elevenlabs`, `raycast`, `runwayml`, `sanity`, `spacex`, `supabase` — ship a
`description:` containing an unquoted `": "`, which strict YAML reads as a nested mapping and
rejects. `parseFrontmatter` retries once with loose top-level scalars quoted rather than losing
their colours over one unquoted sentence. Without that retry the prose count reads 14, not 8.

Section detection only trusts code fences when they balance. An unclosed fence used to swallow
every section after it — reachable through `get_project_design` on hand-written files, which
routinely carry CSS snippets.

## Safety

- Fetched design content is wrapped in a `<design-md>` envelope marking it as data, not
  instructions.
- Credentials (`authorization`, `cookie`, `proxy-authorization`) are stripped from redirects that
  cross to a different origin, so a 30x can't hand someone's API key to another host.
- `install_design` compares resolved path *segments*, not string prefixes, and refuses to write
  outside the project root.
- The stale-cache fallback never covers a 4xx. A 404/401/403 is the origin saying something
  definite; serving cached content over it would hide a removed or newly gated design forever.

## Caches

| What | TTL | Notes |
|---|---|---|
| Catalog index | 1 hour | New brands appear without a release |
| Sitemap (gated discovery) | 24 hours | Discovery only, never fails a search |
| Document content | 5 minutes | Plus ETag revalidation after that |

All on disk under `~/.cache/frontend-design-mcp` (override with
`FRONTEND_DESIGN_MCP_CACHE_DIR`), keyed by URL hash. In-memory copies expire on the same clock —
the registry lives for the whole server process, which can be days, so a latched memo silently
freezes the catalog.

## Testing

- `test/markdown.test.ts`, `test/project.test.ts`, `test/http.test.ts` — offline, run everywhere.
- `test/contract.test.ts` — live, opt-in via `GETDESIGN_LIVE=1`, the upstream tripwire.
- `scripts/smoke.mjs` — spawns the built server over stdio and drives it as a real MCP client.
- `scripts/token-audit.mjs` — the numbers at the top of this file. Any token claim in a tool
  description or in `skills/design-md/SKILL.md` should be backed by this, not estimated.

Watch for vacuous assertions: `array.every(...)` is true for an empty array, and a real bug hid
behind exactly that.
