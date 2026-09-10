import { parseFeed } from "feedsmith";

export interface ParsedEnclosure { url: string; type: string | null; length: string | null }

export interface ParsedItem {
  dedupKey: string;
  title: string | null;
  url: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  published: string | null;
  enclosure: ParsedEnclosure | null;
}

export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  items: ParsedItem[];
}

type AnyRecord = Record<string, unknown>;

export function parseFeedDocument(text: string): ParsedFeed {
  const { format, feed } = parseFeed(text);
  const f = feed as AnyRecord;
  switch (format) {
    case "atom": return fromAtom(f);
    case "json": return fromJson(f);
    default: return fromRss(f);
  }
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function dedupKey(id: string | null, url: string | null, title: string | null, published: string | null): string {
  return id ?? url ?? `${title ?? ""}|${published ?? ""}`;
}

function fromRss(feed: AnyRecord): ParsedFeed {
  const items = (feed.items as AnyRecord[] | undefined) ?? [];
  return {
    title: str(feed.title),
    siteUrl: str(feed.link),
    items: items.map((item) => {
      const guid = item.guid as AnyRecord | string | undefined;
      const id = typeof guid === "string" ? str(guid) : str(guid?.value);
      const url = str(item.link);
      const title = str(item.title);
      const dc = item.dc as AnyRecord | undefined;
      const published = toIso(item.pubDate) ?? toIso(dc?.date);
      const enc = (item.enclosures as AnyRecord[] | undefined)?.[0];
      return {
        dedupKey: dedupKey(id, url, title, published),
        title, url,
        author: str(item.author) ?? str(dc?.creator),
        summary: str(item.description),
        content: str((item.content as AnyRecord | undefined)?.encoded) ?? str(item.description),
        published,
        enclosure: enc && str(enc.url)
          ? { url: enc.url as string, type: str(enc.type), length: enc.length == null ? null : String(enc.length) }
          : null,
      };
    }),
  };
}

function alternateHref(links: unknown): string | null {
  const list = (links as AnyRecord[] | undefined) ?? [];
  const alt = list.find((l) => l.rel === "alternate" || l.rel == null);
  return str(alt?.href);
}

function fromAtom(feed: AnyRecord): ParsedFeed {
  const entries = (feed.entries as AnyRecord[] | undefined) ?? [];
  return {
    title: str(feed.title),
    siteUrl: alternateHref(feed.links),
    items: entries.map((entry) => {
      const id = str(entry.id);
      const url = alternateHref(entry.links);
      const title = str(entry.title);
      const published = toIso(entry.published) ?? toIso(entry.updated);
      const authors = entry.authors as AnyRecord[] | undefined;
      return {
        dedupKey: dedupKey(id, url, title, published),
        title, url,
        author: str(authors?.[0]?.name),
        summary: str(entry.summary),
        content: str(entry.content) ?? str(entry.summary),
        published,
        enclosure: null,
      };
    }),
  };
}

function fromJson(feed: AnyRecord): ParsedFeed {
  const items = (feed.items as AnyRecord[] | undefined) ?? [];
  return {
    title: str(feed.title),
    siteUrl: str(feed.home_page_url),
    items: items.map((item) => {
      const id = str(item.id);
      const url = str(item.url);
      const title = str(item.title);
      const published = toIso(item.date_published) ?? toIso(item.date_modified);
      const authors = item.authors as AnyRecord[] | undefined;
      const att = (item.attachments as AnyRecord[] | undefined)?.[0];
      return {
        dedupKey: dedupKey(id, url, title, published),
        title, url,
        author: str(authors?.[0]?.name) ?? str((item.author as AnyRecord | undefined)?.name),
        summary: str(item.summary),
        content: str(item.content_html) ?? str(item.content_text) ?? str(item.summary),
        published,
        enclosure: att && str(att.url)
          ? { url: att.url as string, type: str(att.mime_type), length: att.size_in_bytes == null ? null : String(att.size_in_bytes) }
          : null,
      };
    }),
  };
}
