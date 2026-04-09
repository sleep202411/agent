import { createFileRoute } from "@tanstack/react-router";
import AssetsPage from "@/app/[locale]/(studio)/assets/page";

export const Route = createFileRoute("/$locale/_studio/assets")({
  component: AssetsPage,
});
