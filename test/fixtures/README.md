# Test fixtures

These four files are real `DESIGN.md` documents fetched from
[getdesign.md](https://getdesign.md), maintained by VoltAgent. They are committed here as
**parser fixtures** so the unit tests can run offline, and each was chosen because it exercises a
specific real-world shape the parser has to survive:

| File | Why it is here |
|---|---|
| `stripe.md` | Ordinary YAML frontmatter with named token roles — the common case (68 of 76) |
| `tesla.md` | Prose-only, no frontmatter, numbered `## 1. …` headings (8 of 76) |
| `nike.md` | `description:` written as a YAML block scalar (`\|`) |
| `supabase.md` | `description:` containing an unquoted `": "`, which strict YAML rejects |

The content is VoltAgent's, not this project's, and is included as unmodified reference material
for testing. It is not redistributed as part of the published npm package — `package.json`
`files` ships only `dist`, `skill` and the docs. getdesign.md's `robots.txt` declares
`Content-Signal: search=yes, ai-train=no, use=reference`; this is reference use, and nothing here
is used to train anything.

If you would rather not vendor third-party prose at all, these can be reduced to minimal
synthetic excerpts that reproduce the same four shapes — the live contract tests in
`test/contract.test.ts` already exercise the real catalog directly.
