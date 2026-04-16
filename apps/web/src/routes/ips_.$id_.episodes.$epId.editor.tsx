import { createFileRoute } from "@tanstack/react-router";
import InteractiveEditorPage from "@/app/[locale]/(ips)/ip/[id]/episodes/[epId]/editor/page";

export const Route = createFileRoute("/ips_/$id_/episodes/$epId/editor")({
  component: InteractiveEditorRoute,
});

function InteractiveEditorRoute() {
  const { id, epId } = Route.useParams();
  return <InteractiveEditorPage id={id} epId={epId} />;
}
