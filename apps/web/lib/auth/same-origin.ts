export function isSameOrigin(
  requestUrl: string,
  originHeader: string | null,
  hostHeader: string | null = null,
  secFetchSite: string | null = null,
): boolean {
  /* Fetch metadata from the browser is authoritative when present: an
     explicit cross-site/same-site request is refused even if the Origin
     header is missing. Requests without fetch metadata (server-to-server
     calls, tests, older agents) fall through to the Origin comparison. */
  if (secFetchSite !== null && secFetchSite !== "") {
    if (secFetchSite === "same-origin" || secFetchSite === "none") return true;
    if (secFetchSite === "cross-site" || secFetchSite === "same-site") return false;
  }
  if (originHeader === null || originHeader.trim() === "") return true;
  try {
    const origin = new URL(originHeader);
    if (origin.origin === new URL(requestUrl).origin) return true;
    return hostHeader !== null && origin.host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}
