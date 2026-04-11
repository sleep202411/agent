import { createFileRoute } from "@tanstack/react-router";
import CreateIPPage from "@/app/[locale]/(ips)/ip/create/page";

export const Route = createFileRoute("/ips/create")({
  component: CreateIPPage,
});
