import { createFileRoute } from "@tanstack/react-router";
import InteractiveEditorPage from "@/app/[locale]/(profile)/profile/interactive/[id]/page";

export const Route = createFileRoute("/profile_/interactive/$id")({
  component: InteractiveEditorPage,
});
