import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Entry auth pages we bounce signed-in users away from.
  const isAuthEntry =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password");
  // Routes reachable without (normal) auth. /reset-password and /auth carry a
  // recovery/confirmation session, so they must NOT redirect a signed-in user.
  const isPublicRoute =
    isAuthEntry ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth") ||
    // Public invite landing (/join/[code]) must be reachable while logged out so
    // a brand-new invitee can see the league and sign up. Note this is distinct
    // from the in-app /league/join form, which stays auth-gated.
    pathname.startsWith("/join") ||
    pathname === "/";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthEntry) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // Skip auth gating for public static assets. PWA files (manifest.json, sw.js)
  // and robots.txt must stay publicly fetchable or install / service-worker
  // registration / audits break for cookieless requests.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
