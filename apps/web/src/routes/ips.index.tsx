import { createFileRoute } from "@tanstack/react-router";
import IPPlazaPage from "@/app/[locale]/(ips)/ip/page";

export const Route = createFileRoute("/ips/")({
  component: IPPlazaPage,
});
