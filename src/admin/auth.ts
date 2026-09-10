export function isAdminAuthorized(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get("Authorization");
  if (!header) return false;
  const expected = `Bearer ${token}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
