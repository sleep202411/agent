import { createFileRoute } from "@tanstack/react-router";
import ProjectsPage from "@/app/[locale]/(studio)/projects/page";

export const Route = createFileRoute("/_studio/projects")({
  component: ProjectsPage,
});
