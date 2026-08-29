const AUTHENTICATED_ROUTE_PREFIXES = [
  "/portal",
  "/staff",
  "/apply/student",
  "/apply/job",
  "/sign-in/invite",
  "/sign-in/reset-password",
  "/sign-in/totp",
] as const;

export function safeAuthRedirect(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, "https://fass.invalid");
    if (parsed.origin !== "https://fass.invalid") return fallback;
    const allowed = AUTHENTICATED_ROUTE_PREFIXES.some((prefix) =>
      parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`),
    );
    return allowed ? `${parsed.pathname}${parsed.search}` : fallback;
  } catch {
    return fallback;
  }
}
