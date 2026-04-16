import { createFileRoute } from "@tanstack/react-router";
import AssetsPage from "@/app/[locale]/(studio)/assets/page";

export const Route = createFileRoute("/_studio/assets")({
  component: AssetsPage,
});
