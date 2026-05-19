import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { projectWorkspaceRoute } from "@/src/lib/studio-routes";

type SearchParams = Record<string, string | string[] | undefined>;

interface Props {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<SearchParams>;
}

/**
 * Legacy project workspace URLs used to live at `/projects/[id]`.
 * Keep that entire subtree as a server redirect so old browser history,
 * invite links, and locale switches land in the real Art Studio route
 * without a client-side 404 flash.
 */
export default async function LegacyProjectsRedirect({ params, searchParams }: Props) {
  const [{ slug = [] }, resolvedSearchParams, hdrs] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const [projectId, ...rest] = slug;
  const locale = hdrs.get("x-locale") ?? "en-US";

  if (!projectId) {
    redirect(`/${locale}/art-studio`);
  }

  const suffix = rest.length ? `/${rest.map(encodeURIComponent).join("/")}` : "";
  redirect(
    `/${locale}${projectWorkspaceRoute(projectId, { suffix })}${encodeSearchParams(resolvedSearchParams)}`
  );
}

function encodeSearchParams(searchParams: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
