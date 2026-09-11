const PREFIX = "tag:google.com,2005:reader/item/";

export function toLongItemId(id: number): string {
  return PREFIX + id.toString(16).padStart(16, "0");
}

export function parseItemId(value: string): number | null {
  if (value.startsWith(PREFIX)) {
    const hexPart = value.slice(PREFIX.length);
    if (!/^[0-9a-fA-F]{1,16}$/.test(hexPart)) return null;
    return Number.parseInt(hexPart, 16);
  }
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}
