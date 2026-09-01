import { type NextRequest, NextResponse } from "next/server";

/**
 * Session refresh middleware (plan.md §4, @supabase/ssr Next.js 15
 * convention). Runs on every request; in demo mode (no Supabase public env)
 * it is a pure pass-through so the frontend prototype is untouched.
 *
 * getClaims() verifies the token and triggers refresh when needed; refreshed
 * cookies are written back on supabaseResponse. Do not run code between
 * createServerClient and getClaims().
 *
 * The Supabase SSR client is imported lazily so the edge bundle never
 * evaluates its code-generation helpers when the demo adapter is active.
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  /* Preserve the original pathname AND search so the staff layout can
     redirect legacy /staff URLs with their query strings intact. */
  const pathnameWithSearch = request.nextUrl.pathname + (request.nextUrl.search || "");
  requestHeaders.set("x-fass-pathname", pathnameWithSearch);
  const nextResponse = () => NextResponse.next({ request: { headers: requestHeaders } });
  const sessionPath = ["/portal", "/staff", "/administrator", "/principal", "/apply", "/sign-in", "/auth", "/api", "/register", "/session-expired", "/access-denied"]
    .some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`));
  if (!sessionPath) return nextResponse();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return nextResponse();

  const { createServerClient } = await import("@supabase/ssr");

  let supabaseResponse = nextResponse();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        requestHeaders.set("cookie", request.cookies.toString());
        supabaseResponse = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  void data?.claims;

  return supabaseResponse;
}

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // All routes except static assets and the demo image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
