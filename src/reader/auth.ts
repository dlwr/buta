export type ReaderTokenKind = "auth" | "write";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readerToken(kind: ReaderTokenKind, email: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`buta:${kind}:${email}`)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isReaderAuthorized(request: Request, email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const header = request.headers.get("Authorization");
  const m = header?.match(/^GoogleLogin auth=(\S+)$/);
  if (!m) return false;
  return timingSafeEqual(m[1]!, await readerToken("auth", email, password));
}

export async function isValidWriteToken(token: string | null, email: string, password: string): Promise<boolean> {
  if (!token || !email || !password) return false;
  return timingSafeEqual(token, await readerToken("write", email, password));
}

export function parseClientLogin(body: string): { email: string; password: string } | null {
  const form = new URLSearchParams(body);
  const email = form.get("Email");
  const password = form.get("Passwd");
  if (!email || !password) return null;
  return { email, password };
}
