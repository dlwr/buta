export interface FetchFeedInput { feedUrl: string; etag: string | null; lastModified: string | null }

export type FetchFeedResult =
  | { status: "ok"; text: string; etag: string | null; lastModified: string | null }
  | { status: "not-modified" }
  | { status: "error"; message: string };

const USER_AGENT = "buta/1.0 (+https://github.com/dlwr/buta)";
const ACCEPT = "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";
const TIMEOUT_MS = 20_000;

export async function fetchFeed(input: FetchFeedInput, fetchFn: typeof fetch): Promise<FetchFeedResult> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: ACCEPT };
  if (input.etag) headers["If-None-Match"] = input.etag;
  if (input.lastModified) headers["If-Modified-Since"] = input.lastModified;
  try {
    const res = await fetchFn(input.feedUrl, {
      headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 304) return { status: "not-modified" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return {
      status: "ok",
      text: decodeBody(new Uint8Array(await res.arrayBuffer()), res.headers.get("Content-Type")),
      etag: res.headers.get("ETag"),
      lastModified: res.headers.get("Last-Modified"),
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const label = bomEncoding(bytes)
    ?? contentType?.match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1]
    ?? declaredEncoding(bytes)
    ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function bomEncoding(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

function declaredEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/)?.[1]
    ?? head.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1]
    ?? null;
}
