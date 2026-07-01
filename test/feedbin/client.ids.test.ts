import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

function jsonFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

function client(fetchFn: typeof fetch) {
  return new FeedbinClient({ credentials: { email: "a@b.com", password: "pw" }, fetchFn });
}

describe("FeedbinClient id endpoints", () => {
  it("getUnreadEntryIds returns the id array", async () => {
    const fetchFn = jsonFetch([4087, 4088, 4089]);
    const ids = await client(fetchFn as unknown as typeof fetch).getUnreadEntryIds();
    expect(ids).toEqual([4087, 4088, 4089]);
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/unread_entries.json");
  });

  it("getStarredEntryIds hits the starred endpoint", async () => {
    const fetchFn = jsonFetch([11, 22]);
    const ids = await client(fetchFn as unknown as typeof fetch).getStarredEntryIds();
    expect(ids).toEqual([11, 22]);
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/starred_entries.json");
  });
});
