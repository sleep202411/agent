import { api } from "@/lib/api";

export interface ProjectCrewAssetContext {
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

export function getProjectCrewAssetContext(projectId: string) {
  return api.get<ProjectCrewAssetContext>(
    `/aurora/projects/${encodeURIComponent(projectId)}/crew-assets/context`
  );
}

export function listProjectCrewAssets(
  projectId: string,
  input: { parentId?: string; query?: string; cursor?: string }
) {
  return api.get<ProjectCrewAssetList>(
    `/aurora/projects/${encodeURIComponent(projectId)}/crew-assets`,
    {
      params: {
        parentId: input.parentId,
        query: input.query,
        cursor: input.cursor,
        source: "all",
        sort: "modified",
        limit: 200,
      },
    }
  );
}
