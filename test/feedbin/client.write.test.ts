import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

function echoFetch() {
  // Echoes back the ids sent in the body, like Feedbin does on success.
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, number[]>;
    const ids = Object.values(body)[0]!;
    return new Response(JSON.stringify(ids), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
}

function client(fetchFn: typeof fetch) {
  return new FeedbinClient({ credentials: { email: "a@b.com", password: "pw" }, fetchFn });
}

describe("FeedbinClient write endpoints", () => {
  it("markEntriesRead DELETEs unread_entries and returns confirmed ids", async () => {
    const fetchFn = echoFetch();
    const out = await client(fetchFn as unknown as typeof fetch).markEntriesRead([1, 2, 3]);
    expect(out).toEqual([1, 2, 3]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.feedbin.com/v2/unread_entries.json");
    expect(init!.method).toBe("DELETE");
    expect(JSON.parse(String(init!.body))).toEqual({ unread_entries: [1, 2, 3] });
  });

  it("chunks writes at 1000 ids per request", async () => {
    const fetchFn = echoFetch();
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1);
    const out = await client(fetchFn as unknown as typeof fetch).markEntriesRead(ids);
    expect(out).toHaveLength(1500);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body)) as { unread_entries: number[] };
    expect(first.unread_entries).toHaveLength(1000);
  });

  it("returns [] without fetching when ids is empty", async () => {
    const fetchFn = vi.fn();
    const out = await client(fetchFn as unknown as typeof fetch).markEntriesRead([]);
    expect(out).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("starEntries POSTs and unstarEntries DELETEs starred_entries", async () => {
    const f1 = echoFetch();
    await client(f1 as unknown as typeof fetch).starEntries([7]);
    expect(f1.mock.calls[0]![0]).toBe("https://api.feedbin.com/v2/starred_entries.json");
    expect(f1.mock.calls[0]![1]!.method).toBe("POST");

    const f2 = echoFetch();
    await client(f2 as unknown as typeof fetch).unstarEntries([7]);
    expect(f2.mock.calls[0]![1]!.method).toBe("DELETE");
    expect(JSON.parse(String(f2.mock.calls[0]![1]!.body))).toEqual({ starred_entries: [7] });
  });
});
