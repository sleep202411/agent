import { redirect } from "next/navigation";
import { headers } from "next/headers";

/**
 * `/art-studio/projects` is a legacy alias of `/art-studio` — the
 * studio home itself is the projects list. Bounce to the canonical
 * URL with an explicit locale prefix so the redirect doesn't kick the
 * user back to en-US when their NEXT_LOCALE cookie hasn't been set
 * yet (first visit after deploy, cleared cookies, etc).
 */
export default async function ProjectsIndex(): Promise<never> {
  const hdrs = await headers();
  const locale = hdrs.get("x-locale") ?? "en-US";
  redirect(`/${locale}/art-studio`);
}
