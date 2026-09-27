import { api } from "@/lib/api";

export interface StoryboardChildItem {
  nodeId: string;
  nodeType: string;
  title: string;
  taskId: string | null;
  status: string | null;
}

function storyboardChildrenPath(projectId: string) {
  return projectId.startsWith("story:")
    ? `/aurora/story-projects/${encodeURIComponent(projectId.slice(6))}/storyboard/children`
    : `/aurora/projects/${encodeURIComponent(projectId)}/storyboard/children`;
}

export function listStoryboardChildren(projectId: string, signal?: AbortSignal) {
  return api.get<StoryboardChildItem[]>(storyboardChildrenPath(projectId), {
    signal,
    requestScope: "project",
  });
}

export function linkStoryboardChild(
  projectId: string,
  nodeId: string,
  taskId: string,
  signal?: AbortSignal
) {
  return api.post<{ taskId: string }>(
    `${storyboardChildrenPath(projectId)}/${encodeURIComponent(nodeId)}/link`,
    {
      data: { taskId },
      signal,
      requestScope: "project",
    }
  );
}

export function createStoryboardChild(
  projectId: string,
  nodeId: string,
  input: { title?: string },
  signal?: AbortSignal
) {
  return api.post<{ taskId: string }>(
    `${storyboardChildrenPath(projectId)}/${encodeURIComponent(nodeId)}/create`,
    {
      data: input,
      signal,
      requestScope: "project",
    }
  );
}
