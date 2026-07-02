import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";
import { initSchema } from "../src/db/queries";

const AUTH = { Authorization: "Bearer test-token" };
const DIRTY = `<p onclick="pwn()">hello</p><script>evil()</script><a href="javascript:alert(1)">x</a><img src="https://x/y.png" onerror="pwn()">`;

beforeEach(async () => {
  await initSchema(env.DB);
  await env.DB.exec("DELETE FROM entries");
  await env.DB.prepare(
    "INSERT INTO entries (id, feed_id, title, url, content, summary, created_at, is_unread, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 't')",
  ).bind(1, 10, "title", "http://x/1", DIRTY, "sum", "2026-07-01T00:00:00Z").run();
});

function get(path: string, headers: Record<string, string> = AUTH) {
  return worker.fetch(
    new Request(`https://buta.example${path}`, { headers }),
    env as never, {} as never,
  );
}

describe("GET /entry/:id", () => {
  it("401 without token", async () => {
    expect((await get("/entry/1", {})).status).toBe(401);
  });

  it("404 for unknown id", async () => {
    expect((await get("/entry/999")).status).toBe(404);
  });

  it("returns the entry with sanitized content", async () => {
    const res = await get("/entry/1");
    expect(res.status).toBe(200);
    const body = await res.json() as { title: string; url: string; content: string };
    expect(body.title).toBe("title");
    expect(body.url).toBe("http://x/1");
    expect(body.content).toContain("hello");
    expect(body.content).toContain("y.png");        // safe img kept
    expect(body.content).not.toContain("<script");   // script removed
    expect(body.content).not.toContain("onclick");   // event handler stripped
    expect(body.content).not.toContain("onerror");
    expect(body.content).not.toContain("javascript:"); // js: href stripped
  });
});
