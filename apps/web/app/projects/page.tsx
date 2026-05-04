import { redirect } from "next/navigation";
import { headers } from "next/headers";

/**
 * `/projects` (no id) has no real page in this app — the per-project
 * workspace lives at `/projects/[id]` and the listing surface is
 * `/art-studio`. Anyone landing here (manual URL entry, broken link,
 * code that constructed the URL without an id, browser auto-reload
 * after a crash) gets bounced to art-studio so they see something
 * useful instead of a bare not-found page.
 *
 * `redirect()` issues an HTTP redirect that hits proxy.ts again; an
 * unprefixed target leans on cookie/Accept-Language to land on the
 * right locale, and a single bad cookie write upstream can flip the
 * user to en-US. Read the locale that proxy.ts already resolved (via
 * the `x-locale` request header it sets) and emit a locale-prefixed
 * target directly — one HTTP hop, no locale-loss surface.
 */
export default async function ProjectsIndex() {
  const hdrs = await headers();
  const locale = hdrs.get("x-locale") ?? "en-US";
  redirect(`/${locale}/art-studio`);
}
