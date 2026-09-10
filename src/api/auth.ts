function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isBasicAuthorized(request: Request, email: string, password: string): boolean {
  if (!email || !password) return false;
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const okUser = timingSafeEqual(decoded.slice(0, sep), email);
  const okPass = timingSafeEqual(decoded.slice(sep + 1), password);
  return okUser && okPass;
}

export function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="buta"' } });
}
