import { api } from "@/lib/api";

export interface ProjectCrewAssetContext {
  canSaveFromCanvas?: boolean;
  crew: {
    id: string;
    name: string;
    logo: string;
  } | null;
  assetContext: {
    capabilities: { view: boolean };
  } | null;
}

export interface ProjectCrewAssetNode {
  id: string;
  parentId: string | null;
  name: string;
  kind: "folder" | "file";
  media: {
    id: string;
    kind: "image" | "video" | "audio" | "document" | "other";
    contentType: string;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    previewUrl: string;
  } | null;
}

export interface ProjectCrewAssetList {
  items: ProjectCrewAssetNode[];
  parentId: string | null;
  source: "all";
  nextCursor: string | null;
}

function crewAssetPath(projectId: string) {
  return projectId.startsWith("story:")
    ? `/aurora/story-projects/${encodeURIComponent(projectId.slice(6))}/crew-assets`
    : `/aurora/projects/${encodeURIComponent(projectId)}/crew-assets`;
}

export function getProjectCrewAssetContext(projectId: string, signal?: AbortSignal) {
  return api.get<ProjectCrewAssetContext>(`${crewAssetPath(projectId)}/context`, {
    signal,
    requestScope: "project",
  });
}

export function listProjectCrewAssets(
  projectId: string,
  input: { parentId?: string; query?: string; cursor?: string; recursive?: boolean }
) {
  return api.get<ProjectCrewAssetList>(crewAssetPath(projectId), {
    requestScope: "project",
    params: {
      parentId: input.parentId,
      query: input.query,
      cursor: input.cursor,
      source: input.recursive ? "recent" : "all",
      sort: "modified",
      limit: 200,
    },
  });
}

export async function listAllProjectCrewAssets(projectId: string, signal?: AbortSignal) {
  const items: ProjectCrewAssetNode[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.get<ProjectCrewAssetList>(crewAssetPath(projectId), {
      params: { source: "recent", sort: "modified", limit: 200, cursor },
      signal,
      requestScope: "project",
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
