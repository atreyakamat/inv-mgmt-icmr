import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DB_SCHEMA } from "@/lib/env";
import { authCookieName, supabaseServerUrl } from "@/lib/supabase/config";
import { CLAIMS_HEADER, type ForwardedClaims } from "@/lib/supabase/claims-header";

/**
 * Refreshes the Supabase session cookie on every request and keeps signed-out
 * visitors on the public routes. Authorisation itself happens in the pages
 * (lib/auth.ts) and in the database (RLS), never here.
 *
 * This project signs sessions with a shared secret rather than per-project
 * signing keys, so verifying the JWT (getClaims()) is a real network call to
 * Supabase Auth, not a local check. That call has to happen here regardless
 * (to redirect signed-out visitors before anything renders), so the result is
 * forwarded to the page as a request header: pages then trust it instead of
 * paying for a second identical network round trip on every navigation. The
 * header is always set here, overwriting anything a client sent, so nothing
 * downstream can forge it.
 */
export async function proxy(request: NextRequest) {
  const cookiesToForward: { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }[] = [];

  const supabase = createServerClient(
    supabaseServerUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: DB_SCHEMA },
      cookieOptions: { name: authCookieName },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToForward.push(...cookiesToSet);
        },
      },
    },
  );

  // Validates the JWT and refreshes it if needed (collected above).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);

  if (signedIn) {
    const claims: ForwardedClaims = { sub: data!.claims.sub, email: data!.claims.email ?? null };
    request.headers.set(CLAIMS_HEADER, JSON.stringify(claims));
  } else {
    // Clients cannot reach a page without going through this proxy, but clear
    // it anyway so an anonymous request can never carry a stale value.
    request.headers.delete(CLAIMS_HEADER);
  }

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" || pathname.startsWith("/auth/") || pathname === "/api/health";

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next({ request });
  cookiesToForward.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
