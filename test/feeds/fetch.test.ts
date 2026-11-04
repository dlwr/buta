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
  it("decodes the body with the charset from the XML declaration", async () => {
    const body = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="EUC-JP"?><t>'), 0xc6, 0xfc, 0xb5, 0xad, ...new TextEncoder().encode("</t>")]);
    const r = await fetchFeed(input, fakeFetch(() => new Response(body, { headers: { "Content-Type": "application/rdf+xml" } })));
    expect(r.status === "ok" && r.text).toBe('<?xml version="1.0" encoding="EUC-JP"?><t>日記</t>');
  });

  it("prefers the charset from Content-Type over the XML declaration", async () => {
    const body = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><t>'), 0x93, 0xfa, 0x8b, 0x4c, ...new TextEncoder().encode("</t>")]);
    const r = await fetchFeed(input, fakeFetch(() => new Response(body, { headers: { "Content-Type": "text/xml; charset=Shift_JIS" } })));
    expect(r.status === "ok" && r.text).toBe('<?xml version="1.0" encoding="UTF-8"?><t>日記</t>');
  });
});
