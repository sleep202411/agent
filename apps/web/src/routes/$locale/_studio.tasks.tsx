import { createFileRoute } from "@tanstack/react-router";
import TasksPage from "@/app/[locale]/(studio)/tasks/page";

export const Route = createFileRoute("/$locale/_studio/tasks")({
  component: TasksPage,
});
