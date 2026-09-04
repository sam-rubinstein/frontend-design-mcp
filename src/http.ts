/**
 * HTTP client built on node:https rather than global fetch.
 *
 * Why not fetch: designmd.ai sits behind Cloudflare rules that return 403 to undici (Node's
 * fetch implementation) while returning 200 to node:https and curl under the same declared
 * User-Agent. Verified by interleaved probes - curl 200 / fetch 403, three rounds. Those same
 * rules 403 a "Mozilla/5.0" or "curl/8.0" User-Agent, so the site is gating on client identity
 * and is friendly to clients that identify themselves. We therefore identify honestly and use a
 * client that is not blocked; nothing here impersonates a browser.
 */

import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export const USER_AGENT =
  "frontend-design-mcp/0.1 (+https://github.com/sam-rubinstein/frontend-design-mcp)";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Treated as success so callers can branch on it instead of catching. */
  allowStatus?: number[];
}

export interface FetchResult {
  status: number;
  body: string;
  etag?: string;
}

function decompress(res: IncomingMessage): Readable {
  switch (res.headers["content-encoding"]) {
    case "gzip":
      return res.pipe(createGunzip());
    case "br":
      return res.pipe(createBrotliDecompress());
    case "deflate":
      return res.pipe(createInflate());
    default:
      return res;
  }
}

/**
 * Largest response we will hold in memory. The biggest real DESIGN.md is ~43KB and the largest
 * catalog document is the sitemap at ~104KB, so this is generous by two orders of magnitude.
 * It exists because we accept gzip and brotli: a small compressed payload can expand without
 * bound, and nothing upstream is under our control.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

async function readBody(stream: Readable, url: string): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      stream.destroy();
      throw new HttpError(
        `GET ${url} returned more than ${MAX_BODY_BYTES} bytes after decompression; refusing to buffer it`,
        0,
        url,
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Caller headers minus any user-agent, whatever its casing.
 *
 * The User-Agent is this client identifying itself to sites that gate on client identity; it is
 * not a knob for callers. Other headers stay overridable - httpGetJson legitimately sets accept.
 */
export function callerHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "user-agent"),
  );
}

function once(url: string, opts: FetchOptions): Promise<{ res: IncomingMessage; body: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          "accept-encoding": "gzip, deflate, br",
          ...callerHeaders(opts.headers),
          "user-agent": USER_AGENT,
        },
      },
      (res) => {
        // Redirects are followed by the caller, which needs the Location header.
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ res, body: "" });
          return;
        }
        // A 304 has no body by definition.
        if (status === 304) {
          res.resume();
          resolve({ res, body: "" });
          return;
        }
        readBody(decompress(res), url).then(
          (body) => resolve({ res, body }),
          (err: Error) =>
            reject(
              err instanceof HttpError
                ? err
                : new HttpError(`GET ${url} failed while reading: ${err.message}`, status, url),
            ),
        );
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new HttpError(`GET ${url} timed out after ${timeoutMs}ms`, 0, url));
    });
    req.on("error", (err: Error) =>
      reject(new HttpError(`GET ${url} failed: ${err.message}`, 0, url)),
    );
    req.end();
  });
}

/** Header names that must never survive a hop to a different origin. */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/**
 * Drops credentials when a redirect crosses to a different origin.
 *
 * Without this, a 30x from designmd.ai (or a CDN in front of it) pointing at another host would
 * hand that host the user's DESIGNMD_API_KEY. Same-origin redirects keep the header so ordinary
 * path rewrites still work.
 */
export function headersForHop(
  headers: Record<string, string> | undefined,
  from: string,
  to: string,
): Record<string, string> | undefined {
  if (!headers) return headers;
  if (new URL(from).origin === new URL(to).origin) return headers;
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.includes(name.toLowerCase())),
  );
}

export async function httpGet(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  let target = url;
  let hopOpts = opts;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { res, body } = await once(target, hopOpts);
    const status = res.statusCode ?? 0;

    if (status >= 300 && status < 400 && res.headers.location) {
      const next = new URL(res.headers.location, target).toString();
      hopOpts = { ...hopOpts, headers: headersForHop(hopOpts.headers, target, next) };
      target = next;
      continue;
    }

    const ok = (status >= 200 && status < 300) || (opts.allowStatus ?? []).includes(status);
    if (!ok) {
      throw new HttpError(
        `GET ${target} failed: ${status} ${res.statusMessage ?? ""}`.trim(),
        status,
        target,
      );
    }

    const etag = res.headers.etag;
    return { status, body, etag: typeof etag === "string" ? etag : undefined };
  }

  throw new HttpError(`GET ${url} exceeded ${MAX_REDIRECTS} redirects`, 0, url);
}

export async function httpGetJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await httpGet(url, {
    ...opts,
    headers: { accept: "application/json", ...opts.headers },
  });
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new HttpError(`GET ${url} returned invalid JSON`, res.status, url);
  }
}
