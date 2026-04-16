import { createFileRoute } from "@tanstack/react-router";
import CrewDetailPage from "@/app/[locale]/(crews)/crews/[id]/page";

export const Route = createFileRoute("/crews_/$id")({
  component: CrewDetailRoute,
});

function CrewDetailRoute() {
  const { id } = Route.useParams();
  return <CrewDetailPage id={id} />;
}
