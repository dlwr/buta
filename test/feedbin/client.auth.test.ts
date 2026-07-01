import { describe, it, expect, vi } from "vitest";
import { FeedbinClient } from "../../src/feedbin/client";

function fakeFetch(status: number) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status }));
}

describe("FeedbinClient.verifyCredentials", () => {
  it("sends Basic auth to the authentication endpoint", async () => {
    const fetchFn = fakeFetch(200);
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "pw" },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const ok = await client.verifyCredentials();

    expect(ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.feedbin.com/v2/authentication.json");
    const auth = (init!.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe("Basic " + btoa("a@b.com:pw"));
  });

  it("returns false on 401", async () => {
    const client = new FeedbinClient({
      credentials: { email: "a@b.com", password: "wrong" },
      fetchFn: fakeFetch(401) as unknown as typeof fetch,
    });
    expect(await client.verifyCredentials()).toBe(false);
  });
});
