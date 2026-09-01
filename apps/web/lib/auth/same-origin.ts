export function isSameOrigin(
  requestUrl: string,
  originHeader: string | null,
  hostHeader: string | null = null,
): boolean {
  if (originHeader === null || originHeader.trim() === "") return true;
  try {
    const origin = new URL(originHeader);
    if (origin.origin === new URL(requestUrl).origin) return true;
    return hostHeader !== null && origin.host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}
