import { parseOpml } from "feedsmith";
import { findFeedByUrl, insertFeed } from "../db/feeds";
import { findTagging, insertTagging } from "../db/taggings";

export interface OpmlImportResult { feedsAdded: number; feedsSkipped: number; taggingsAdded: number }

interface Outline { text?: string; title?: string; type?: string; xmlUrl?: string; htmlUrl?: string; outlines?: Outline[] }
interface FlatFeed { xmlUrl: string; title: string; siteUrl: string | null; folder: string | null }

function flatten(outlines: Outline[], folder: string | null, out: FlatFeed[]): void {
  for (const o of outlines) {
    if (o.xmlUrl) {
      out.push({ xmlUrl: o.xmlUrl, title: o.title || o.text || o.xmlUrl, siteUrl: o.htmlUrl ?? null, folder });
    } else if (o.outlines) {
      flatten(o.outlines, o.text ?? o.title ?? folder, out);
    }
  }
}

export async function importOpml(db: D1Database, opmlText: string, now: string): Promise<OpmlImportResult> {
  const opml = parseOpml(opmlText) as { body?: { outlines?: Outline[] } };
  const flat: FlatFeed[] = [];
  flatten(opml.body?.outlines ?? [], null, flat);

  const result: OpmlImportResult = { feedsAdded: 0, feedsSkipped: 0, taggingsAdded: 0 };
  const seen = new Set<string>();
  for (const f of flat) {
    let feed = await findFeedByUrl(db, f.xmlUrl);
    if (!seen.has(f.xmlUrl)) {
      seen.add(f.xmlUrl);
      if (feed) {
        result.feedsSkipped++;
      } else {
        feed = await insertFeed(db, { feedUrl: f.xmlUrl, siteUrl: f.siteUrl, title: f.title, createdAt: now });
        result.feedsAdded++;
      }
    }
    if (f.folder && feed && !(await findTagging(db, feed.id, f.folder))) {
      await insertTagging(db, feed.id, f.folder);
      result.taggingsAdded++;
    }
  }
  return result;
}
