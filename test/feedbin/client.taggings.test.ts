import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

describe("FeedbinClient.getTaggings", () => {
  it("returns taggings", async () => {
    const fetchFn = vi.fn(async (_url: string) => new Response(JSON.stringify([
      { id: 4, feed_id: 1, name: "Core" },
      { id: 5, feed_id: 2, name: "News" },
    ]), { status: 200, headers: { "content-type": "application/json" } }));

    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const taggings = await client.getTaggings();
    expect(taggings).toHaveLength(2);
    expect(taggings[0]).toEqual({ id: 4, feed_id: 1, name: "Core" });
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/taggings.json");
  });
});
