"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { DehydratedState } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "@/components/providers";
import i18n, { setLanguage, useLocale } from "@/src/i18n/i18n";
import { setCurrentLocale, localeFromPathname } from "@/src/i18n/locale-url";

export function RootLayoutClient({
  initialLocale,
  dehydratedState,
  children,
}: {
  initialLocale: string;
  dehydratedState?: DehydratedState;
  children: React.ReactNode;
}) {
  // Synchronously align i18next language with request locale BEFORE first render.
  // This runs during both SSR and client hydration so both produce identical markup.
  useState(() => {
    if (i18n.language !== initialLocale) {
      void i18n.changeLanguage(initialLocale);
    }
    setCurrentLocale(initialLocale);
  });

  const pathname = usePathname() ?? "/";
  const i18nLocale = useLocale();

  // Keep in sync on subsequent client-side navigation.
  useEffect(() => {
    const urlLocale = localeFromPathname(pathname);
    setCurrentLocale(urlLocale);
    if (urlLocale !== i18nLocale) {
      setLanguage(urlLocale);
    }
  }, [pathname, i18nLocale]);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <Providers dehydratedState={dehydratedState}>{children}</Providers>
    </ThemeProvider>
  );
}
