# frontend-design-mcp

A unified MCP server for **DESIGN.md** design systems, so your coding agent builds UI that looks
like a real brand instead of default-AI-generic.

It searches three catalogs at once — [getdesign.md](https://getdesign.md),
[designmd.app](https://designmd.app) and [designmd.ai](https://designmd.ai) (which also serves
designmd.co) — and, crucially, returns **only the part you asked for**.

## Why it exists

A DESIGN.md averages 28KB, about 8,000 tokens. An agent that just downloads one burns most of a
context window to answer "what's the primary colour". This server slices instead:

Measured against `getdesign:stripe` (24KB) via a real MCP client — `npm run audit` reproduces it:

| Question | Call | ~tokens | vs whole doc |
|---|---|---|---|
| "What's Stripe's primary colour?" | `get_design_tokens` with `only: "colors"` | **137** | 2% |
| "What tokens does it define?" | `get_design_tokens` | **390** | 6% |
| "What sections exist?" | `get_design_sections` | **151** | 2% |
| "What are its colour rules?" | `get_design` with `section: "Colors"` | **624** | 10% |
| "Find me something like X" | `search_designs` (5 per provider) | **866** | 14% |
| Reading the file blind | `get_design`, no section | 6,152 | 100% |
| "Adopt Stripe's system" | `install_design` | one-time write to disk | — |

## Install

Requires Node 18+. No account, no API key.

**Claude Code**

```bash
claude mcp add -s user design -- npx -y frontend-design-mcp
```

**Codex** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp"]
```

**Grok CLI** — add to your MCP config:

```json
{
  "mcpServers": {
    "design": {
      "command": "npx",
      "args": ["-y", "frontend-design-mcp"]
    }
  }
}
```

stdio is the transport all three accept locally — Grok in particular refuses stdio for *remote*
servers and takes only Streamable HTTP or SSE there, so a local stdio binary is the one shape
that works everywhere unchanged.

### Optional: designmd.ai content

Search and browse work with no key. To also **download** designmd.ai kits, set a free key from
<https://designmd.ai/api-keys>:

```bash
claude mcp add -s user design -e DESIGNMD_API_KEY=dk_... -- npx -y frontend-design-mcp
```

The variable name matches the one `designmd-mcp` uses, so an existing key is picked up as-is.

### Optional: the companion skill

`skill/SKILL.md` teaches the agent *when* to reach for this server — at the start of frontend
work, when resuming after a break, and when fixing a visual bug — and which tool is cheapest.
Copy it to `.claude/skills/design-md/SKILL.md` in your project (or `~/.claude/skills/` for all
projects).

## Tools

| Tool | Purpose |
|---|---|
| `get_project_design` | Read the project's own DESIGN.md. **Call first** for any UI work. Local, near-free. |
| `search_designs` | Search all catalogs at once. `deep: true` for style queries. |
| `get_design_sections` | List a document's sections and their sizes before reading any. |
| `get_design` | One section (preferred) or the whole document. |
| `get_design_tokens` | Colours, typography, spacing, radii as JSON. The cheap default. |
| `install_design` | Write a DESIGN.md into the project, stamped with its origin. |
| `list_providers` | What's enabled, what's gated, how to ungate it. |
| `check_updates` | Diff getdesign.md's signed index against what you last saw. |

### Search: brand names vs styles

`getdesign.md` indexes brand names, and its index descriptions are boilerplate. A style query
like "warm editorial" matches nothing there by default. Pass `deep: true` to search inside the
documents — about a second on a cold cache, milliseconds after.

```
search_designs("warm editorial cream", deep: true)  ->  claude, mistral.ai, replicate
search_designs("dark fintech", deep: true)          ->  coinbase, revolut, wise
```

## Providers and ranking

| Tier | Provider | Catalog | Search | Content |
|---|---|---|---|---|
| 1 | `getdesign` | 76 brand extractions, sha256-signed | ✅ | ✅ |
| 2 | `designmd.ai` | community kits, tag taxonomy | ✅ | 🔑 needs `DESIGNMD_API_KEY` |
| 3 | `designmd.app` | themed templates, LatAm brands | ✅ | ❌ no download endpoint exists |

Tiers track how much a result can be trusted and whether it can be delivered: getdesign.md is
curated and integrity-verified, designmd.ai is community-uploaded and variable, designmd.app can
only ever return a link. Merged results sort by:

1. **fetchable** — a file you can use beats a link you can't
2. **tier** — the table above
3. **the provider's own relevance order**, preserved as-is

Cross-provider relevance is deliberately not invented. The three catalogs score differently and
normalizing them into one number would be fake precision, so each provider's ranking is kept
intact within its tier. Every result carries its `tier` so the ordering is auditable.

A missing key or a paywall **never hides a result**. Gated designs still appear with
`fetchable: false`, and the response's `gating` map explains what each gated provider needs, so the agent reports a real
limitation instead of silently substituting a different design.

## Integrity

getdesign.md publishes a `sha256` per file in its signed index. Every fetch is verified against
it and a mismatch is refused. All 76 entries verified at build time.

Scope honestly: that digest ships from the same origin as the file, so it detects corruption and
transport tampering and pins the cache. It is **not** independent provenance — whoever controls
the site controls both. The other two providers publish no digests.

## Notes for maintainers

**No published API contracts.** None of the three sites documents its API. getdesign.md's
endpoints were found via its `Link` header (`/.well-known/agent-skills/index.json`);
designmd.ai's came from reading the MIT-licensed `designmd-mcp@0.2.1` package source. So shapes
can change without warning. `test/contract.test.ts` hits the live endpoints for exactly this
reason — run it with `npm run test:live`.

**Why `node:https` and not `fetch`.** designmd.ai sits behind Cloudflare rules that return 403 to
undici (Node's `fetch`) while returning 200 to `node:https` and curl under the same declared
User-Agent. Verified by interleaved probes: curl 200 / fetch 403, three rounds. Those rules also
403 a `Mozilla/5.0` or `curl/8.0` User-Agent, so the site is gating on client identity and is
friendly to clients that identify themselves. This server identifies itself honestly as
`frontend-design-mcp/0.1` and impersonates nothing.

**Two file formats.** 68 of getdesign.md's 76 files have YAML frontmatter with named token roles;
8 are prose-only (kraken, lamborghini, lovable, mastercard, spotify, starbucks, tesla, theverge).

Six of those 68 — elevenlabs, raycast, runwayml, sanity, spacex, supabase — ship a `description:`
containing an unquoted `": "`, which strict YAML reads as a nested mapping and rejects. Rather
than lose their colours and typography over one unquoted sentence, `parseFrontmatter` retries
once with loose top-level scalars quoted. Without that retry those six degrade to regex
extraction, which is how the count reads 14 instead of 8.
For those, `get_design_tokens` regexes hex colours out of the prose and returns `partial: true`
with positional names, plus a note saying what's missing — never a silent empty result.

**Third-party content** is wrapped in a `<design-md>` envelope marking it as data, not
instructions.

## Development

```bash
npm install
npm test           # unit tests, offline
npm run test:live  # adds live contract tests against all three catalogs
```

The published package runs on Node 18 — that is what `engines` declares, and `dist/` is plain
compiled JS. The **test suite** executes TypeScript directly and needs Node 22.6+; the runner
checks your version and says so rather than failing with `Unknown file extension ".ts"`.

```
npm run smoke      # end-to-end: spawns the built server over stdio as a real MCP client
```

## Attribution

Design content belongs to its publishers. getdesign.md is maintained by VoltAgent; designmd.app
by ft.ia.br; designmd.ai/designmd.co by their respective team. This server is an independent
client that fetches on a user's behalf; it does not redistribute, mirror, or train on their
catalogs. getdesign.md's `robots.txt` sets `Content-Signal: search=yes, ai-train=no,
use=reference` — user-initiated reference fetching is what this does, and training on the content
is not.

BSD 3-Clause licensed — see LICENSE.
