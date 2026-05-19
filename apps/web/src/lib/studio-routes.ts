import { getCurrentLocale, localizePath } from "@/src/i18n/locale-url";

type QueryValue = string | number | null | undefined;

interface ProjectRouteOptions {
  suffix?: string;
  worldId?: QueryValue;
  query?: URLSearchParams | Record<string, QueryValue>;
}

function normalizeSuffix(suffix: string | undefined): string {
  if (!suffix) return "";
  return suffix.startsWith("/") ? suffix : `/${suffix}`;
}

function appendQuery(params: URLSearchParams, key: string, value: QueryValue) {
  if (value === null || value === undefined || value === "") return;
  params.set(key, String(value));
}

function buildQuery(options: ProjectRouteOptions): string {
  const params = new URLSearchParams();

  if (options.query instanceof URLSearchParams) {
    options.query.forEach((value, key) => appendQuery(params, key, value));
  } else if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => appendQuery(params, key, value));
  }

  appendQuery(params, "worldId", options.worldId);

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function projectWorkspaceRoute(
  projectId: string | number,
  options: ProjectRouteOptions = {}
): string {
  const id = encodeURIComponent(String(projectId));
  return `/art-studio/projects/${id}${normalizeSuffix(options.suffix)}${buildQuery(options)}`;
}

export function localizedProjectWorkspaceHref(
  projectId: string | number,
  options: ProjectRouteOptions = {}
): string {
  return localizePath(projectWorkspaceRoute(projectId, options), getCurrentLocale());
}

export function isProjectWorkspaceChromePath(pathname: string): boolean {
  const cleanPath = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  if (!cleanPath.startsWith("/art-studio/projects/")) return false;

  const rest = cleanPath.slice("/art-studio/projects/".length);
  return rest.split("/").filter(Boolean).length > 0;
}
