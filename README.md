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

Needs [Node](https://nodejs.org) 18 or newer. Searching all three catalogs and downloading the
76 getdesign.md brands needs no account and no key. Only [designmd.ai
downloads](#optional-designmdai-downloads) need a free key.

### Plugin (recommended)

Installs the MCP server and the companion skill together. The skill is what tells the agent *when*
to reach for the tools — at the start of frontend work, when picking it back up after a break, and
when fixing a visual bug — and which call is cheapest.

**Claude Code**

```text
/plugin marketplace add sam-rubinstein/frontend-design-mcp
/plugin install frontend-design@frontend-design-mcp
```

**Grok**

```bash
grok plugin marketplace add sam-rubinstein/frontend-design-mcp
```

Then open `/marketplace` in the TUI and press `i` on `frontend-design`. Or skip the catalog and
install the repo directly:

```bash
grok plugin install sam-rubinstein/frontend-design-mcp --trust
```

**Codex**

```bash
codex plugin marketplace add sam-rubinstein/frontend-design-mcp
```

Then open `/plugins` and install `frontend-design`, or run
`/plugin install frontend-design@frontend-design-mcp` in the session. Start a new session
afterwards.

### MCP server only

For Cursor, Windsurf, Zed, or if you already have the skill some other way.

**Claude Code**

```bash
claude mcp add -s user design -- npx -y frontend-design-mcp@^0.1.0
claude mcp list   # `design` should show as connected
```

**Codex**

```bash
codex mcp add design -- npx -y frontend-design-mcp@^0.1.0
codex mcp list
```

Restart Codex if it was already running.

<details>
<summary>Or edit <code>~/.codex/config.toml</code> by hand</summary>

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp@^0.1.0"]
```

</details>

**Grok CLI**

```bash
grok mcp add design -- npx -y frontend-design-mcp@^0.1.0
grok mcp list
```

Tools show up namespaced, as `design__search_designs` and so on.

<details>
<summary>Or edit <code>~/.grok/config.toml</code> by hand</summary>

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp@^0.1.0"]
```

</details>

**Cursor, Windsurf, Zed, anything else**

Add this to the client's MCP config file:

```json
{
  "mcpServers": {
    "design": {
      "command": "npx",
      "args": ["-y", "frontend-design-mcp@^0.1.0"]
    }
  }
}
```

This server speaks **stdio**, which every MCP client supports locally.

## Optional: designmd.ai downloads

Searching designmd.ai needs no key. Downloading its community kits needs a free one from
<https://designmd.ai/api-keys>:

```bash
claude mcp add -s user design -e DESIGNMD_API_KEY=dk_your_key -- npx -y frontend-design-mcp@^0.1.0
```

Codex takes the same idea as a flag:

```bash
codex mcp add design --env DESIGNMD_API_KEY=dk_your_key -- npx -y frontend-design-mcp@^0.1.0
```

Grok's `mcp add` has no env flag, so put it in `~/.grok/config.toml`:

```toml
[mcp_servers.design]
command = "npx"
args = ["-y", "frontend-design-mcp@^0.1.0"]
env = { DESIGNMD_API_KEY = "dk_your_key" }
```

Installed as a plugin, the key is read from your environment instead — export `DESIGNMD_API_KEY`
before starting the agent. Without a key nothing vanishes: gated results still appear, labelled
with what they need.

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
