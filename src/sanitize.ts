// Feedbin explicitly leaves sanitizing entry HTML to the client
// ("sanitizing/escaping content is up to you"), so scrub it server-side
// with the runtime's streaming HTMLRewriter before the PWA innerHTMLs it.
const REMOVE_TAGS = [
  "script", "style", "iframe", "object", "embed", "form", "link", "meta", "noscript",
];

const URL_ATTRS = new Set(["href", "src", "srcset", "action", "formaction", "xlink:href"]);

// Allowlist, not blocklist: browsers strip ASCII control chars anywhere in a
// URL before parsing, so "jav\tascript:" executes. Normalize the same way,
// then only accept known-safe schemes (or scheme-less/relative URLs).
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);

function isSafeUrl(value: string): boolean {
  const cleaned = value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  const scheme = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return true; // relative, protocol-relative, or fragment
  return SAFE_SCHEMES.has(scheme[1]!);
}

export async function sanitizeHtml(html: string): Promise<string> {
  const rewriter = new HTMLRewriter();
  for (const tag of REMOVE_TAGS) {
    rewriter.on(tag, { element(el) { el.remove(); } });
  }
  rewriter.on("*", {
    element(el) {
      const drop: string[] = [];
      for (const attr of el.attributes) {
        const name = attr[0];
        if (!name) continue;
        const value = attr[1] ?? "";
        const n = name.toLowerCase();
        if (n.startsWith("on")) drop.push(name);
        else if (URL_ATTRS.has(n) && !isSafeUrl(value)) drop.push(name);
      }
      for (const name of drop) el.removeAttribute(name);
    },
  });
  const res = rewriter.transform(
    new Response(html, { headers: { "content-type": "text/html" } }),
  );
  return res.text();
}
