import { createFileRoute } from "@tanstack/react-router";
import IPEditPage from "@/app/[locale]/(ips)/ip/[id]/edit/page";

export const Route = createFileRoute("/ips_/$id_/edit")({
  component: IPEditRoute,
});

function IPEditRoute() {
  const { id } = Route.useParams();
  return <IPEditPage id={id} />;
}
