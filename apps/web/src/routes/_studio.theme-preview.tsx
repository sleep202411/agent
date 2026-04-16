import { createFileRoute } from "@tanstack/react-router";
import ThemePreviewPage from "@/app/[locale]/(studio)/theme-preview/page";

export const Route = createFileRoute("/_studio/theme-preview")({
  component: ThemePreviewPage,
});
