import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { isValidLocale, defaultLocale } from "@/src/i18n/config";
import { setLanguage, useLocale } from "@/src/i18n/i18n";

export const Route = createFileRoute("/$locale")({
  beforeLoad: ({ params, location }) => {
    if (!isValidLocale(params.locale)) {
      // Not a valid locale — prefix with default locale and redirect
      throw redirect({ to: `/${defaultLocale}${location.pathname}${location.searchStr}` });
    }
  },
  component: LocaleLayout,
});

function LocaleLayout() {
  const { locale } = Route.useParams();
  const currentLang = useLocale();

  useEffect(() => {
    if (locale !== currentLang) {
      setLanguage(locale);
    }
  }, [locale, currentLang]);

  return <Outlet />;
}
