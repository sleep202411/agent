import { createFileRoute } from "@tanstack/react-router";
import CrewWorkspacePage from "@/app/[locale]/(crews)/crews/[id]/workspace/page";

export const Route = createFileRoute("/crews_/$id/workspace")({
  component: CrewWorkspaceRoute,
});

function CrewWorkspaceRoute() {
  const { id } = Route.useParams();
  return <CrewWorkspacePage id={id} />;
}
