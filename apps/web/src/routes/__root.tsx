import { useEffect } from "react";
import { HeadContent, Scripts, createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "@/components/providers";
import { GlobalNav } from "@/components/layout/global-nav";
import { getCurrentLocale } from "@/src/i18n/locale-url";
import { setLanguage, useLocale } from "@/src/i18n/i18n";

import appCss from "@/app/globals.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRoute({
  notFoundComponent: () => (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
    </div>
  ),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FizzDragon Studio" },
      {
        name: "description",
        content: "AI Animation & IP Co-creation Platform",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const locale = getCurrentLocale();
  return (
    <html lang={locale} suppressHydrationWarning className="h-full antialiased font-sans">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  // Re-render on navigation so getCurrentLocale() picks up the latest value
  useLocation();
  const rewriteLocale = getCurrentLocale();
  const i18nLocale = useLocale();

  useEffect(() => {
    if (rewriteLocale !== i18nLocale) {
      setLanguage(rewriteLocale);
    }
  }, [rewriteLocale, i18nLocale]);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <Providers>
        <GlobalNav />
        <Outlet />
      </Providers>
    </ThemeProvider>
  );
}
