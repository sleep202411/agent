import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next 16 "proxy" (formerly middleware). next-intl handles locale detection +
// the redirect from an unprefixed path to /<locale>/…
export default createMiddleware(routing);

export const config = {
  // Run on page routes only. Skip API routes, the backend proxies
  // (/aurora → NestJS, /user → Java auth), Next internals, and any file
  // with an extension (favicon, images, etc.).
  matcher: ["/((?!api|aurora|user|_next|_vercel|.*\\..*).*)"],
};
