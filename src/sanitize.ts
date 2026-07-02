// Feedbin explicitly leaves sanitizing entry HTML to the client
// ("sanitizing/escaping content is up to you"), so scrub it server-side
// with the runtime's streaming HTMLRewriter before the PWA innerHTMLs it.
const REMOVE_TAGS = [
  "script", "style", "iframe", "object", "embed", "form", "link", "meta", "noscript",
];

const URL_ATTRS = new Set(["href", "src", "srcset", "action", "formaction", "xlink:href"]);

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
        else if (URL_ATTRS.has(n) && /^\s*javascript:/i.test(value)) drop.push(name);
      }
      for (const name of drop) el.removeAttribute(name);
    },
  });
  const res = rewriter.transform(
    new Response(html, { headers: { "content-type": "text/html" } }),
  );
  return res.text();
}
