import { createFileRoute } from "@tanstack/react-router";
import CreatorDetailPage from "@/app/[locale]/(creators)/creators/[id]/page";

export const Route = createFileRoute("/creators_/$id")({
  component: CreatorDetailPage,
});
