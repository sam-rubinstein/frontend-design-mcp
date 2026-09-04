/**
 * DESIGN.md parsing. Two variants exist in the wild:
 *   frontmatter - YAML tokens, then "## Colors" style headings
 *   prose       - no frontmatter, "# Design System Inspired by X", "## 1. Visual Theme" headings
 * Everything here tolerates both.
 */
import { parse as parseYaml } from "yaml";
import type { DesignTokens } from "./types.js";

export interface Section {
  /** Heading text as written, e.g. "1. Visual Theme & Atmosphere". */
  title: string;
  /** Lowercased, de-numbered, for matching: "visual theme & atmosphere". */
  key: string;
  /** Character length of the section body, so callers can budget context. */
  length: number;
  startLine: number;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function hasFrontmatter(content: string): boolean {
  return FRONTMATTER_RE.test(content);
}

export function detectVariant(content: string): "frontmatter" | "prose" {
  return hasFrontmatter(content) ? "frontmatter" : "prose";
}

/**
 * Quotes top-level scalar values that contain an unescaped ": ".
 *
 * Several catalog entries ship a prose `description:` with an inner colon, which YAML reads as
 * a nested mapping and rejects. Losing the whole block over one unquoted sentence would throw
 * away the colors and typography too, which is the part callers actually want.
 */
function quoteLooseScalars(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([A-Za-z0-9_¡-￿-]+):[ \t]+(.*)$/.exec(line);
      if (!m) return line;
      const [, key, value] = m;
      const alreadySafe =
        !value.includes(": ") || /^["'|>]/.test(value.trim()) || value.trim() === "";
      if (alreadySafe) return line;
      return `${key}: ${JSON.stringify(value.trim())}`;
    })
    .join("\n");
}

/** Returns the YAML block as an object, or undefined when there is none / it is unrecoverable. */
export function parseFrontmatter(content: string): Record<string, unknown> | undefined {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return undefined;

  const attempts = [match[1], quoteLooseScalars(match[1])];
  for (const candidate of attempts) {
    try {
      const parsed = parseYaml(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // Try the next, more forgiving, interpretation.
    }
  }
  return undefined;
}

/** The markdown after the frontmatter (or the whole document when there is none). */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "");
}

/** Normalizes "## 3. Colors" and "## Colors" to the same lookup key. */
function sectionKey(title: string): string {
  return title
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim()
    .toLowerCase();
}

/** Every level-2 heading, with the size of the text beneath it. */
export function listSections(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const found: { title: string; startLine: number }[] = [];

  // Headings inside code blocks are not headings - but only trust fences when they balance.
  // An unclosed fence would otherwise swallow every section after it, which is far worse than
  // occasionally picking up a "## " line from inside a snippet.
  const fenceLines = lines.filter((l) => /^\s*```/.test(l)).length;
  const trustFences = fenceLines % 2 === 0;

  let inFence = false;
  lines.forEach((line, i) => {
    if (trustFences && /^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) found.push({ title: m[1], startLine: i });
  });

  return found.map((h, i) => {
    const end = i + 1 < found.length ? found[i + 1].startLine : lines.length;
    const body = lines.slice(h.startLine, end).join("\n");
    return {
      title: h.title,
      key: sectionKey(h.title),
      length: body.length,
      startLine: h.startLine,
    };
  });
}

/**
 * Returns one section's markdown, heading included.
 * Matches on the de-numbered, case-insensitive title, so "colors" finds "## 3. Colors".
 */
export function sliceSection(content: string, name: string): string | undefined {
  const sections = listSections(content);
  const want = sectionKey(name);
  // Exact match wins wherever it sits in the document. A single findIndex over
  // (exact || prefix) would return "Colors Extended" for a request of "Colors" purely
  // because it appears first.
  const exact = sections.findIndex((s) => s.key === want);
  const idx = exact !== -1 ? exact : sections.findIndex((s) => s.key.startsWith(want));
  if (idx === -1) return undefined;

  const lines = content.split(/\r?\n/);
  const start = sections[idx].startLine;
  const end = idx + 1 < sections.length ? sections[idx + 1].startLine : lines.length;
  return lines.slice(start, end).join("\n").trimEnd();
}

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

/**
 * Last resort for prose files: pull hex colors out of the body in document order.
 * Lossy by construction - there are no token names to recover, so keys are positional.
 */
export function extractColorsFromProse(content: string): Record<string, string> {
  const seen: string[] = [];
  for (const match of content.matchAll(HEX_RE)) {
    const hex = match[0].toLowerCase();
    if (!seen.includes(hex)) seen.push(hex);
  }
  return Object.fromEntries(seen.map((hex, i) => [`color-${i + 1}`, hex]));
}

function asRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}

/** Normalized tokens from either variant. `partial` tells the caller how much to trust it. */
export function extractTokens(id: string, content: string): DesignTokens {
  const fm = parseFrontmatter(content);

  if (fm) {
    const colors = asRecord(fm.colors) ?? {};
    // A frontmatter block that yielded no usable colors is not complete just because it parsed:
    // the colors key may be missing, or a list rather than a map.
    const noColors = Object.keys(colors).length === 0;
    return {
      id,
      source: "frontmatter",
      partial: noColors,
      note: noColors
        ? "The frontmatter parsed but carried no usable color map, so colors are empty here. " +
          "Read the Colors section with get_design instead."
        : undefined,
      colors,
      typography: fm.typography,
      spacing: fm.spacing,
      rounded: fm.rounded,
      components: fm.components,
    };
  }

  const colors = extractColorsFromProse(content);
  return {
    id,
    source: "extracted",
    partial: true,
    colors,
    note:
      "This file has no YAML frontmatter, so colors were regexed out of the prose and have " +
      "positional names rather than roles (primary, canvas, ...). Typography, spacing, rounded " +
      "and components are not machine-readable here - read the relevant section with get_design instead.",
  };
}

/** Title from the leading H1, for prose files that have no frontmatter `name`. */
export function extractTitle(content: string): string | undefined {
  const m = /^#\s+(.+?)\s*$/m.exec(stripFrontmatter(content));
  return m?.[1];
}
