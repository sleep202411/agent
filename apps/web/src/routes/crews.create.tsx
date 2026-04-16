import { createFileRoute } from "@tanstack/react-router";
import CreateCrewPage from "@/app/[locale]/(crews)/crews/create/page";

export const Route = createFileRoute("/crews/create")({
  component: CreateCrewPage,
});
