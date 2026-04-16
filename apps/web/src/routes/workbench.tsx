import { createFileRoute } from "@tanstack/react-router";
import WorkbenchPage from "@/app/[locale]/(workbench)/workbench/page";

export const Route = createFileRoute("/workbench")({
  component: WorkbenchPage,
});
