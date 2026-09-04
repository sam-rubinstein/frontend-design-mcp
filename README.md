# frontend-design-mcp

Gives your AI coding agent a real design system to follow, so the UI it writes looks like a brand
you picked instead of generic AI output.

It searches three public catalogs of `DESIGN.md` files — [getdesign.md](https://getdesign.md),
[designmd.app](https://designmd.app) and [designmd.ai](https://designmd.ai) — and hands back
**only the part your agent asked for**, not the whole 28KB document.

```text
You:   Restyle my landing page to match Airbnb.
Agent: [reads Airbnb's tokens - 137 tokens of context, not 6,152]
       primary #ff385c · canvas #ffffff · ink #222222 · hairline #dddddd
```

76 brands are downloadable outright — Stripe, Apple, Airbnb, Notion, Vercel, Linear, Figma, IBM,
Nike, Tesla, Spotify and more — plus hundreds more searchable across the other two catalogs.

## Setup

Needs [Node](https://nodejs.org) 18 or newer. No account, no API key, nothing to sign up for.

### Claude Code

1. Add the server:

   ```bash
   claude mcp add -s user design -- npx -y frontend-design-mcp
   ```

2. Check it connected:

   ```bash
   claude mcp list
   ```

   `design` should be listed as connected.
3. Try it: *"use design to show me Stripe's colors"*.

### Codex

1. Add the server:

   ```bash
   codex mcp add design -- npx -y frontend-design-mcp
   ```

2. Check it:

   ```bash
   codex mcp list
   ```

3. Restart Codex if it was already running.

<details>
<summary>Or edit <code>~/.codex/config.toml</code> by hand</summary>

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp"]
```

</details>

### Grok CLI

1. Add the server:

   ```bash
   grok mcp add design -- npx -y frontend-design-mcp
   ```

2. Check it:

   ```bash
   grok mcp list
   ```

3. Tools show up namespaced, as `design__search_designs` and so on.

<details>
<summary>Or edit <code>~/.grok/config.toml</code> by hand</summary>

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp"]
```

</details>

### Cursor, Windsurf, Zed, anything else

Add this to the client's MCP config file:

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

This server speaks **stdio**, which every MCP client supports locally.

## Recommended: add the skill too

The server supplies the data. The companion skill teaches your agent *when* to reach for it — at
the start of frontend work, when picking it back up after a break, and when fixing a visual bug —
and which call is cheapest.

Copy [`skill/SKILL.md`](skill/SKILL.md) to `.claude/skills/design-md/SKILL.md` in your project, or
to `~/.claude/skills/design-md/SKILL.md` to turn it on everywhere.

## Optional: designmd.ai downloads

Searching designmd.ai needs no key. Downloading its community kits needs a free one from
<https://designmd.ai/api-keys>:

```bash
claude mcp add -s user design -e DESIGNMD_API_KEY=dk_your_key -- npx -y frontend-design-mcp
```

Codex takes the same idea as a flag:

```bash
codex mcp add design --env DESIGNMD_API_KEY=dk_your_key -- npx -y frontend-design-mcp
```

Grok's `mcp add` has no env flag, so put it in `~/.grok/config.toml`:

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp"]
env = { DESIGNMD_API_KEY = "dk_your_key" }
```

Without a key nothing vanishes — gated results still appear, labelled with what they need.

## What your agent gets

| Tool | What it's for |
|---|---|
| `get_project_design` | Read your project's own `DESIGN.md`. Called first for any UI work. |
| `search_designs` | Search all three catalogs at once. |
| `get_design_tokens` | Colors, type, spacing, radii as JSON. The cheap default. |
| `get_design_sections` | List a document's sections before reading one. |
| `get_design` | One section, or the whole document. |
| `install_design` | Write a `DESIGN.md` into your project. |
| `list_providers` | What's enabled, and what needs a key. |
| `check_updates` | Which brands changed upstream since you last looked. |

## Development

```bash
npm install
npm run lint       # Biome
npm test           # offline unit tests
npm run test:live  # adds live tests against the real catalogs
npm run smoke      # drives the built server over stdio as a real MCP client
npm run audit      # measures what each tool costs in tokens
```

The published package runs on Node 18. The test suite executes TypeScript directly and needs Node
22.18+; the runner will tell you if your version is too old.

How it works and why: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Attribution

Design content belongs to its publishers — getdesign.md is maintained by VoltAgent, designmd.app
by ft.ia.br, designmd.ai by its own team. This is an independent client that fetches on your
behalf; it does not mirror, redistribute, or train on their catalogs. The files are reference
material, not exact reproductions of any brand.

BSD 3-Clause licensed — see [LICENSE](LICENSE).
