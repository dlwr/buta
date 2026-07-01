import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

describe("FeedbinClient default fetch binding", () => {
  it("calls the global fetch with correct `this` (no illegal invocation)", async () => {
    const calls: string[] = [];
    // Mimics the Workers native fetch, which throws "Illegal invocation"
    // when called with a `this` that is not globalThis/undefined.
    function pickyFetch(this: unknown, url: string) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      calls.push(url);
      return Promise.resolve(
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    vi.stubGlobal("fetch", pickyFetch);
    try {
      // No fetchFn provided -> must use the (correctly bound) global fetch.
      const client = new FeedbinClient({ credentials: { email: "a@b.com", password: "pw" } });
      const taggings = await client.getTaggings();
      expect(taggings).toEqual([]);
      expect(calls[0]).toBe("https://api.feedbin.com/v2/taggings.json");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
