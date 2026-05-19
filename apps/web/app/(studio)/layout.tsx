import { headers } from "next/headers";
import { StudioShell } from "@/app/(studio)/_components/studio-shell";

/**
 * Studio route group — isolated from `(site)`. The client shell owns
 * all studio-level chrome so workspace routes can opt out at the
 * layout level instead of hiding header/sidebar with CSS.
 *
 * Kept intentionally minimal so this slice can be extracted into a
 * standalone Next.js app on its own domain later — see
 * `memory/project_fizzstudio_subdomain.md`.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const isStudioHost = hdrs.get("x-studio-host") === "1";
  return <StudioShell isStudioHost={isStudioHost}>{children}</StudioShell>;
}
