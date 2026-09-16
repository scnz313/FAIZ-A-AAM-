export type StaffPortalLabel = "Administrator" | "Principal" | "Staff";

export function staffPortalLabel(pathname: string): StaffPortalLabel {
  if (pathname === "/administrator" || pathname.startsWith("/administrator/")) return "Administrator";
  if (pathname === "/principal" || pathname.startsWith("/principal/")) return "Principal";
  return "Staff";
}

export function staffRouteTitle(pathname: string): string {
  const cleanPathname = pathname.replace(/\?.*$/, "");
  const suffix = cleanPathname.replace(/^\/(?:administrator|principal|staff)(?=\/|$)/, "") || "/";
  if (suffix === "/") return "Home";
  if (suffix === "/users") return "Staff access";
  if (suffix === "/guardians") return "Guardians";
  if (suffix === "/link-requests") return "Guardian links";
  if (suffix === "/data/exports") return "Data exports";
  if (suffix === "/settings") return "Settings";
  if (suffix === "/audit") return "Audit";
  return "Staff portal";
}
