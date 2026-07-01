import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";
import type { FeedbinEntry } from "../../src/feedbin/types";

function entry(id: number): FeedbinEntry {
  return {
    id, feed_id: 1, title: `t${id}`, url: `http://x/${id}`, author: null,
    summary: "s", content: "c", published: null, created_at: "2026-07-01T00:00:00Z",
  };
}

describe("FeedbinClient.getEntriesByIds", () => {
  it("returns [] without fetching when ids is empty", async () => {
    const fetchFn = vi.fn();
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(await client.getEntriesByIds([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("splits into batches of 100 and concatenates", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const fetchFn = vi.fn(async (url: string) => {
      const idsParam = new URL(url).searchParams.get("ids")!;
      const batch = idsParam.split(",").map(Number).map(entry);
      return new Response(JSON.stringify(batch), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.getEntriesByIds(ids);

    expect(result).toHaveLength(150);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstIds = new URL(fetchFn.mock.calls[0]![0] as string).searchParams.get("ids")!.split(",");
    expect(firstIds).toHaveLength(100);
  });
});
