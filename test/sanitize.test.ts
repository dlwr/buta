import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../src/sanitize";

describe("sanitizeHtml URL schemes", () => {
  it("keeps http/https/mailto/relative/fragment links", async () => {
    const out = await sanitizeHtml(
      `<a href="https://a/b">1</a><a href="http://a">2</a>` +
      `<a href="mailto:x@y">3</a><a href="/rel">4</a><a href="#f">5</a>` +
      `<img src="//cdn.example/i.png">`,
    );
    expect(out).toContain(`href="https://a/b"`);
    expect(out).toContain(`href="mailto:x@y"`);
    expect(out).toContain(`href="/rel"`);
    expect(out).toContain(`href="#f"`);
    expect(out).toContain(`src="//cdn.example/i.png"`);
  });

  it("strips javascript: even with embedded tab/newline obfuscation", async () => {
    const out = await sanitizeHtml(
      `<a href="jav\tascript:alert(1)">x</a><a href="java\nscript:alert(1)">y</a>`,
    );
    expect(out).not.toContain("script:alert");
  });

  it("strips data: and vbscript: URLs", async () => {
    const out = await sanitizeHtml(
      `<a href="data:text/html,<script>1</script>">d</a><a href="vbscript:msg">v</a>`,
    );
    expect(out).not.toContain(`href="data:`);
    expect(out).not.toContain("vbscript:");
  });
});
