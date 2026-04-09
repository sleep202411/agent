import { createFileRoute } from "@tanstack/react-router";
import SettingsPage from "@/app/[locale]/(studio)/settings/page";

export const Route = createFileRoute("/$locale/_studio/settings")({
  component: SettingsPage,
});
