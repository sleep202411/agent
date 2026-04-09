import { createFileRoute } from "@tanstack/react-router";
import CreatorDetailPage from "@/app/[locale]/(creators)/creators/[id]/page";

export const Route = createFileRoute("/$locale/creators_/$id")({
  component: CreatorDetailPage,
});
