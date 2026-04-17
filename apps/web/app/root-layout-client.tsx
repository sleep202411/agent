"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "@/components/providers";
import { GlobalNav } from "@/components/layout/global-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { setLanguage, useLocale } from "@/src/i18n/i18n";
import { setCurrentLocale, localeFromPathname } from "@/src/i18n/locale-url";

export function RootLayoutClient({
  initialLocale,
  children,
}: {
  initialLocale: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const i18nLocale = useLocale();

  // Keep i18next language in sync with URL-derived locale.
  useEffect(() => {
    const urlLocale = localeFromPathname(pathname);
    setCurrentLocale(urlLocale);
    if (urlLocale !== i18nLocale) {
      setLanguage(urlLocale);
    }
  }, [pathname, i18nLocale]);

  // Hide footer on studio, project editor, and workbench pages (full-screen layouts)
  const hideFooter =
    pathname.startsWith("/projects/") ||
    pathname.startsWith("/workbench") ||
    pathname.includes("/editor");

  void initialLocale; // surfaced via x-locale header; consumed here only for server render lang attr

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <Providers>
        <GlobalNav />
        {children}
        {!hideFooter && <SiteFooter />}
      </Providers>
    </ThemeProvider>
  );
}
