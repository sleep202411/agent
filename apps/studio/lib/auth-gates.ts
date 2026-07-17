/**
 * Page-level auth gating. Studio is browse-first: most pages are PUBLIC (home,
 * image / video galleries show community work without login) and only the
 * working surfaces require a signed-in user. So we keep an explicit list of the
 * PROTECTED routes — everything else is public by default.
 *
 * This is a UX gate, not the security boundary: data is additionally protected
 * server-side (any API 401 raises the sign-in dialog). A path missing from this
 * list therefore can't leak protected data — it just renders before its own API
 * calls prompt login. Action-level gating (the "Generate" button on a public
 * page) is separate — use `requireAuth` from the auth provider.
 *
 * Paths here are LOCALE-STRIPPED, matching next-intl's `usePathname()`
 * (e.g. "/canvas", not "/zh-CN/canvas").
 */
import { locales } from "@/i18n/config";

const PROTECTED_PREFIXES = [
  "/canvas",
  "/projects",
  "/project",
  "/story-studio/projects",
  "/settings",
  "/invite",
] as const;

function stripLocalePrefix(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const [, firstSegment = "", ...rest] = normalized.split("/");
  if (!(locales as readonly string[]).includes(firstSegment)) return normalized;
  return rest.length === 0 ? "/" : `/${rest.join("/")}`;
}

/** True when a (locale-stripped) path requires a signed-in user to view. */
export function isProtectedPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
