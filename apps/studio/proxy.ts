import createMiddleware from "next-intl/middleware";
import { routing } from "@/src/i18n/routing";
import { locales } from "@/src/i18n/config";
import { PUBLIC_PATHS } from "@/src/lib/auth";
import { NextRequest } from "next/server";

const intlMiddleware = createMiddleware(routing);

const localePrefix = new RegExp(`^\\/(${locales.join("|")})`);

function stripLocale(pathname: string): string {
  return pathname.replace(localePrefix, "") || "/";
}

export default function proxy(request: NextRequest) {
  const path = stripLocale(request.nextUrl.pathname);

  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return intlMiddleware(request);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|anon|studio|user|project|vedio|content|_next|_vercel|.*\\..*).*)"],
};
