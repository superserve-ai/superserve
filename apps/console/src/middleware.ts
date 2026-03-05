import type { NextRequest } from "next/server";
import {
  PUBLIC_ROUTES,
  createSupabaseClient,
  matchesRoute,
} from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createSupabaseClient(request);
  if (!supabase) return response;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES);

  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone();
    signinUrl.pathname = "/auth/signin";
    signinUrl.searchParams.set("next", pathname);
    return Response.redirect(signinUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
