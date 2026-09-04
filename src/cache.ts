/**
 * Disk cache keyed by URL. Content is revalidated with ETags, so a warm cache
 * costs one 304 rather than a full re-download.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type FetchOptions, HttpError, httpGet } from "./http.js";

const CACHE_DIR =
  process.env.FRONTEND_DESIGN_MCP_CACHE_DIR ?? join(homedir(), ".cache", "frontend-design-mcp");

interface CacheEntry {
  url: string;
  etag?: string;
  body: string;
  fetchedAt: number;
}

function keyFor(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

async function readEntry(url: string): Promise<CacheEntry | undefined> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${keyFor(url)}.json`), "utf8");
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return undefined;
  }
}

async function writeEntry(entry: CacheEntry): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${keyFor(entry.url)}.json`), JSON.stringify(entry), "utf8");
  } catch {
    // A read-only or full disk must not break a tool call; we just lose the cache.
  }
}

export interface CachedFetchOptions extends FetchOptions {
  /** Serve straight from disk without revalidating while younger than this. */
  maxAgeMs?: number;
  /**
   * Ignore the cached copy entirely: no age shortcut and no If-None-Match, so the origin must
   * send a body. Sending the ETag would let the server answer 304 and hand back the very entry
   * the caller is trying to bypass.
   */
  force?: boolean;
}

/** GET with an on-disk cache. Falls back to stale content when the network fails. */
export async function cachedGet(url: string, opts: CachedFetchOptions = {}): Promise<string> {
  const entry = await readEntry(url);
  const age = entry ? Date.now() - entry.fetchedAt : Infinity;

  if (entry && !opts.force && opts.maxAgeMs !== undefined && age < opts.maxAgeMs) {
    return entry.body;
  }

  try {
    const res = await httpGet(url, {
      ...opts,
      headers: {
        ...opts.headers,
        ...(entry?.etag && !opts.force ? { "if-none-match": entry.etag } : {}),
      },
      allowStatus: [...(opts.allowStatus ?? []), 304],
    });

    if (res.status === 304 && entry) {
      await writeEntry({ ...entry, fetchedAt: Date.now() });
      return entry.body;
    }

    await writeEntry({ url, etag: res.etag, body: res.body, fetchedAt: Date.now() });
    return res.body;
  } catch (err) {
    // Offline with a warm cache beats a failed tool call - but only for transport and server
    // faults. A 4xx is the origin telling us something definite (gone, forbidden, unauthorized);
    // serving cached content over it would hide a removed or newly-gated design indefinitely.
    const status = err instanceof HttpError ? err.status : 0;
    const definitive = status >= 400 && status < 500;
    if (entry && !definitive) return entry.body;
    throw err;
  }
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export { CACHE_DIR };
