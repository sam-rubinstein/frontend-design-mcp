/**
 * The local side: finding, reading and writing the project's own DESIGN.md.
 *
 * This is what makes a resumed session cheap. An agent picking up frontend work after a
 * break - or fixing a visual bug days later - reads the design contract already sitting in
 * the repo instead of re-searching the catalogs and re-downloading a file it already has.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256Hex } from "./cache.js";
import type { Section } from "./markdown.js";
import { detectVariant, extractTitle, extractTokens, listSections } from "./markdown.js";
import type { DesignDocument, DesignTokens } from "./types.js";

/** Where a DESIGN.md conventionally lives, in the order agents should prefer. */
const SEARCH_PATHS = [
  "DESIGN.md",
  "design.md",
  "docs/DESIGN.md",
  ".claude/DESIGN.md",
  "src/DESIGN.md",
];

/**
 * Trailing marker written on install so a later session can tell where the file came from.
 *
 * Reads either name: files installed before the project was renamed carry `getdesign-mcp:`, and
 * orphaning them would silently turn a known-origin DESIGN.md into an unknown one.
 */
const PROVENANCE_RE =
  /<!--\s*(?:frontend-design-mcp|getdesign-mcp):\s*source=(\S+)\s+sha256=([0-9a-f]{64})\s+installed=(\S+)\s*-->/;

const PROVENANCE_LABEL = "frontend-design-mcp";

export interface ProjectDesign {
  /** Path relative to the project root. */
  path: string;
  title?: string;
  variant: "frontmatter" | "prose";
  sections: Section[];
  tokens: DesignTokens;
  /** Set when the file was installed by this server and still carries its marker. */
  source?: string;
  /** True when the file has been edited since install (hash no longer matches the marker). */
  modifiedSinceInstall?: boolean;
  bytes: number;
}

function provenanceOf(
  content: string,
): { source: string; sha256: string; installed: string } | undefined {
  const m = PROVENANCE_RE.exec(content);
  return m ? { source: m[1], sha256: m[2], installed: m[3] } : undefined;
}

/** The document without its provenance marker, for hashing against the recorded digest. */
function withoutProvenance(content: string): string {
  return `${content.replace(PROVENANCE_RE, "").trimEnd()}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Finds the project's DESIGN.md, if it has one. Checks conventional locations in order. */
export async function findProjectDesign(root: string): Promise<ProjectDesign | undefined> {
  for (const candidate of SEARCH_PATHS) {
    const full = join(root, candidate);
    if (!(await exists(full))) continue;

    const content = await readFile(full, "utf8");
    const prov = provenanceOf(content);
    const body = withoutProvenance(content);

    return {
      path: candidate,
      title: extractTitle(content),
      variant: detectVariant(content),
      sections: listSections(content),
      tokens: extractTokens(prov?.source ?? candidate, content),
      source: prov?.source,
      modifiedSinceInstall: prov ? sha256Hex(body) !== prov.sha256 : undefined,
      bytes: content.length,
    };
  }
  return undefined;
}

export interface InstallResult {
  path: string;
  bytes: number;
  overwrote: boolean;
}

/**
 * Writes a fetched design into the project, stamped with its origin.
 * Refuses to escape the project root.
 */
export async function installDesign(
  doc: DesignDocument,
  root: string,
  targetPath = "DESIGN.md",
  overwrite = false,
): Promise<InstallResult> {
  if (isAbsolute(targetPath)) {
    throw new Error(`target_path must be relative to the project root; got "${targetPath}".`);
  }
  const full = resolve(root, targetPath);
  const rel = relative(resolve(root), full);
  // Compare path segments, not string prefixes: a plain startsWith("..") also rejects an
  // innocent filename like "..hidden.md" that resolves inside the root.
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`target_path must stay inside the project root; "${targetPath}" escapes it.`);
  }

  const already = await exists(full);
  if (already && !overwrite) {
    throw new Error(
      `${targetPath} already exists. Pass overwrite:true to replace it, or read the current one ` +
        `with get_project_design first.`,
    );
  }

  const body = `${doc.content.trimEnd()}\n`;
  const marker =
    `\n<!-- ${PROVENANCE_LABEL}: source=${doc.id} sha256=${sha256Hex(body)} ` +
    `installed=${new Date().toISOString()} -->\n`;

  // The conventional locations this module searches include docs/ and .claude/, so a target in
  // a subdirectory is expected rather than exotic - create it instead of failing with ENOENT.
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, body + marker, "utf8");
  return { path: targetPath, bytes: body.length + marker.length, overwrote: already };
}
