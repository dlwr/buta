import { fetchFeed } from "./fetch";
import { parseFeedDocument } from "./parse";

const FEED_TYPES = ["application/rss+xml", "application/atom+xml", "application/feed+json", "application/json"];

export function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
    if (!/\balternate\b/i.test(attr("rel") ?? "")) continue;
    if (!FEED_TYPES.includes((attr("type") ?? "").toLowerCase())) continue;
    const href = attr("href");
    if (!href) continue;
    try {
      out.push(new URL(href, baseUrl).href);
    } catch {
      continue;
    }
  }
  return out;
}

export type ResolveResult =
  | { kind: "feed"; feedUrl: string; text: string }
  | { kind: "none" }
  | { kind: "error"; message: string };

export async function resolveFeed(url: string, fetchFn: typeof fetch): Promise<ResolveResult> {
  const first = await fetchFeed({ feedUrl: url, etag: null, lastModified: null }, fetchFn);
  if (first.status === "error") return { kind: "error", message: first.message };
  if (first.status === "not-modified") return { kind: "error", message: "HTTP 304" };
  if (isFeed(first.text)) return { kind: "feed", feedUrl: url, text: first.text };
  const candidate = discoverFeedUrls(first.text, url)[0];
  if (!candidate) return { kind: "none" };
  const second = await fetchFeed({ feedUrl: candidate, etag: null, lastModified: null }, fetchFn);
  if (second.status !== "ok" || !isFeed(second.text)) return { kind: "none" };
  return { kind: "feed", feedUrl: candidate, text: second.text };
}

function isFeed(text: string): boolean {
  try {
    parseFeedDocument(text);
    return true;
  } catch {
    return false;
  }
}
