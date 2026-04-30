"use client";

/**
 * Resolve the right URL for an "Edit IP" entry point.
 *
 * The new `/ips/[id]/edit` page is still under construction. Embedded
 * sessions (the platform iframe-mounted inside legacy fizzdragon-web)
 * hand off to the legacy editor at `PARENT_ORIGIN` so creators on
 * production keep working end-to-end. Standalone sessions — local dev
 * on `localhost:3000`, or eventually direct-domain users once the new
 * page is feature-complete — stay on the new edit route.
 *
 * Drop this hook (and `legacyProjectEditUrl` in `shared.ts`) once the
 * new edit page is finished and we cut over fully.
 */

import { useIsInIframe } from "@/src/hooks/use-is-in-iframe";
import { legacyProjectEditUrl } from "./shared";

export function useProjectEditUrl(projectId: string | number): string {
  const inIframe = useIsInIframe();
  return inIframe ? legacyProjectEditUrl(projectId) : `/ips/${projectId}/edit`;
}
