import type { Metadata } from "next";
import Script from "next/script";
import { headers } from "next/headers";
import { RootLayoutClient } from "@/app/root-layout-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "FizzDragon Studio",
  description: "AI Animation & IP Co-creation Platform",
};

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale is resolved by proxy.ts and attached to the request via x-locale header.
  const headerBag = await headers();
  const locale = headerBag.get("x-locale") ?? "en-US";

  return (
    <html lang={locale} suppressHydrationWarning className="h-full antialiased font-sans">
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <RootLayoutClient initialLocale={locale}>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
