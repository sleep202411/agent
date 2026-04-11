import { createFileRoute } from "@tanstack/react-router";
import IPDetailPage from "@/app/[locale]/(ips)/ip/[id]/page";

export const Route = createFileRoute("/ips_/$id")({
  component: IPDetailRoute,
});

function IPDetailRoute() {
  const { id } = Route.useParams();
  return <IPDetailPage id={id} />;
}
