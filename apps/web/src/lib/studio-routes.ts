import { getCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";

type QueryValue = string | number | null | undefined;

interface StudioRouteOptions {
  /**
   * On studio.fizzdragon.com the visible URL is intentionally clean:
   * /zh-CN/projects/:id internally routes to /art-studio/projects/:id.
   * Chrome decisions still need to use the routed art-studio pathname.
   */
  isStudioHost?: boolean;
}

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

export function isProjectWorkspaceChromePath(
  pathname: string,
  options: StudioRouteOptions = {}
): boolean {
  const cleanPath = normalizeStudioPath(pathname, options);
  if (!cleanPath.startsWith("/art-studio/projects/")) return false;

  const rest = cleanPath.slice("/art-studio/projects/".length);
  return rest.split("/").filter(Boolean).length > 0;
}

export function isArtStudioPath(pathname: string, options: StudioRouteOptions = {}): boolean {
  return normalizeStudioPath(pathname, options).startsWith("/art-studio");
}

export function normalizeStudioPath(
  pathname: string,
  { isStudioHost = false }: StudioRouteOptions = {}
): string {
  const cleanPath = stripLocalePrefix(pathname.split("?")[0]?.replace(/\/+$/, "") || "/");
  if (isStudioHost && !cleanPath.startsWith("/art-studio")) {
    return `/art-studio${cleanPath === "/" ? "" : cleanPath}`;
  }
  return cleanPath;
}
