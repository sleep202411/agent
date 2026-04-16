import { createFileRoute } from "@tanstack/react-router";
import CreatorsPage from "@/app/[locale]/(creators)/creators/page";

export const Route = createFileRoute("/creators/")({
  component: CreatorsPage,
});
