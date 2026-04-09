import { createFileRoute } from "@tanstack/react-router";
import ProjectDetailPage from "@/app/[locale]/(project)/projects/[id]/page";

export const Route = createFileRoute("/$locale/projects_/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    worldId: (search.worldId as string) ?? undefined,
    episodeId: (search.episodeId as string) ?? undefined,
  }),
  component: ProjectDetailPage,
});
