import { createFileRoute } from "@tanstack/react-router";
import CrewsPage from "@/app/[locale]/(crews)/crews/page";

export const Route = createFileRoute("/crews/")({
  component: CrewsPage,
});
