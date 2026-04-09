import { createFileRoute, redirect } from "@tanstack/react-router";
import { defaultLocale, detectBrowserLocale } from "@/src/i18n/config";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const locale = typeof window !== "undefined" ? detectBrowserLocale() : defaultLocale;
    throw redirect({ to: `/${locale}/projects` });
  },
});
