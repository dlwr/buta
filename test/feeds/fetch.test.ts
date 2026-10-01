import { describe, it, expect } from "vitest";
import { fetchFeed } from "../../src/feeds/fetch";

function fakeFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch;
}

const input = { feedUrl: "https://ex.com/feed", etag: '"e1"', lastModified: "Mon, 01 Sep 2026 00:00:00 GMT" };

describe("fetchFeed", () => {
  it("sends If-None-Match from the stored etag", async () => {
    let seen: string | null = null;
    await fetchFeed(input, fakeFetch((req) => { seen = req.headers.get("If-None-Match"); return new Response("x"); }));
    expect(seen).toBe('"e1"');
  });

  it("sends If-Modified-Since from the stored last-modified", async () => {
    let seen: string | null = null;
    await fetchFeed(input, fakeFetch((req) => { seen = req.headers.get("If-Modified-Since"); return new Response("x"); }));
    expect(seen).toBe("Mon, 01 Sep 2026 00:00:00 GMT");
  });

  it("returns not-modified on 304", async () => {
    const r = await fetchFeed(input, fakeFetch(() => new Response(null, { status: 304 })));
    expect(r).toEqual({ status: "not-modified" });
  });

  it("returns body and validators on 200", async () => {
    const r = await fetchFeed(input, fakeFetch(() => new Response("<rss/>", {
      headers: { ETag: '"e2"', "Last-Modified": "Tue, 02 Sep 2026 00:00:00 GMT" },
    })));
    expect(r).toEqual({ status: "ok", text: "<rss/>", etag: '"e2"', lastModified: "Tue, 02 Sep 2026 00:00:00 GMT" });
  });

  it("returns error with status on non-2xx", async () => {
    const r = await fetchFeed(input, fakeFetch(() => new Response("boom", { status: 503 })));
    expect(r).toEqual({ status: "error", message: "HTTP 503" });
  });

  it("returns error when fetch throws", async () => {
    const r = await fetchFeed(input, fakeFetch(() => { throw new Error("dns"); }));
    expect(r).toEqual({ status: "error", message: "dns" });
  });

  describe("charset decoding", () => {
    const eucJp = (s: string) => Uint8Array.from(
      { "にき": [0xa4, 0xcb, 0xa4, 0xad] }[s] ?? [...s].map((c) => c.charCodeAt(0)),
    );
    const concat = (...parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let i = 0;
      for (const p of parts) { out.set(p, i); i += p.length; }
      return out;
    };
    const textOf = async (body: Uint8Array, contentType: string) => {
      const r = await fetchFeed(input, fakeFetch(() => new Response(body, { headers: { "Content-Type": contentType } })));
      return r.status === "ok" ? r.text : null;
    };

    it("decodes using the encoding in the XML declaration when Content-Type has no charset", async () => {
      const body = concat(eucJp('<?xml version="1.0" encoding="EUC-JP"?><rss><title>'), eucJp("にき"), eucJp("</title></rss>"));
      expect(await textOf(body, "application/rdf+xml")).toContain("<title>にき</title>");
    });

    it("decodes using the meta charset of an HTML page", async () => {
      const body = concat(eucJp('<html><head><meta http-equiv="Content-Type" content="text/html; charset=EUC-JP"><title>'), eucJp("にき"), eucJp("</title>"));
      expect(await textOf(body, "text/html")).toContain("<title>にき</title>");
    });

    it("prefers the Content-Type charset over the XML declaration", async () => {
      const body = concat(eucJp('<?xml version="1.0" encoding="UTF-8"?><title>'), eucJp("にき"), eucJp("</title>"));
      expect(await textOf(body, "text/xml; charset=EUC-JP")).toContain("<title>にき</title>");
    });

    it("prefers a UTF-8 BOM over a conflicting Content-Type charset", async () => {
      const body = concat(new Uint8Array([0xef, 0xbb, 0xbf]), new TextEncoder().encode("<title>にき</title>"));
      expect(await textOf(body, "text/xml; charset=EUC-JP")).toBe("<title>にき</title>");
    });

    it("falls back to UTF-8 when the declared encoding is unknown", async () => {
      const body = new TextEncoder().encode('<?xml version="1.0" encoding="x-bogus"?><title>にき</title>');
      expect(await textOf(body, "text/xml")).toContain("<title>にき</title>");
    });
  });
});
