import { createFileRoute } from "@tanstack/react-router";
import ProjectDetailPage from "@/app/[locale]/(project)/projects/[id]/page";

export const Route = createFileRoute("/projects_/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    worldId: search.worldId != null ? String(search.worldId) : undefined,
    episodeId: search.episodeId != null ? String(search.episodeId) : undefined,
  }),
  component: ProjectDetailPage,
});
