import { type NextRequest, NextResponse } from "next/server";

import { createServerClient } from "@supabase/ssr";

/**
 * Session refresh middleware (plan.md §4, @supabase/ssr Next.js 15
 * convention). Runs on every request; in demo mode (no Supabase public env)
 * it is a pure pass-through so the frontend prototype is untouched.
 *
 * getUser() triggers the refresh-token flow when needed; refreshed cookies
 * are written back on supabaseResponse. Do not run code between
 * createServerClient and getUser().
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();
  void user;

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
