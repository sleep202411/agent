import type { Metadata } from "next";
import Script from "next/script";
import { headers } from "next/headers";
import { dehydrate } from "@tanstack/react-query";
import NextTopLoader from "nextjs-toploader";
import { RootLayoutClient } from "@/app/root-layout-client";
import { getServerQueryClient } from "@/src/lib/react-query/server";
import { fetchUserInfoServerSide } from "@/src/lib/auth/server-user";
import { userKeys } from "@/src/hooks/use-user";
import { CANONICAL_HOST, JsonLd, buildOrganization, buildWebSite } from "@/src/lib/seo";
import "./globals.css";

/**
 * `metadataBase` is the absolute URL Next.js resolves all relative
 * `og:image` / `twitter:image` / `alternates.canonical` against.
 * Without it, those links serialise as relative paths in HTML head
 * — fine for browsers, broken for crawlers and link previews. Pin
 * to the canonical brand host (matches the schema.org @id graph).
 */
export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_HOST),
  title: {
    default: "FizzDragon Studio",
    template: "%s · FizzDragon",
  },
  description: "AI Animation & IP Co-creation Platform",
  applicationName: "FizzDragon",
  keywords: [
    "AI Animation",
    "IP Co-creation",
    "AI Storyboard",
    "AI Short Film",
    "Generative Video",
    "Creator Platform",
  ],
  openGraph: {
    type: "website",
    siteName: "FizzDragon",
    url: CANONICAL_HOST,
    title: "FizzDragon — AI Animation & IP Co-creation Platform",
    description: "Script to storyboard to render — with a creator marketplace and IP plaza.",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "FizzDragon",
    description: "AI Animation & IP Co-creation Platform",
    images: ["/logo.png"],
  },
  icons: { icon: "/favicon.ico" },
};

// Default to dark on the server-rendered HTML so the first paint is
// already dark — fixes the white-flash users saw on slow networks
// while the theme-init script downloaded. The script (kept below) is
// still authoritative: if the user's stored preference / OS resolved
// to light, it strips the `dark` class on first interactive tick.
// We bias toward "dark by default" because the brand surfaces are
// dark-leaning and a brief dark→light flip on the small light-mode
// minority is less jarring than the previous light→dark.
const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;root.style.backgroundColor=resolved==='dark'?'#0c0e14':'#ffffff';}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale is resolved by proxy.ts and attached to the request via x-locale header.
  const headerBag = await headers();
  const locale = headerBag.get("x-locale") ?? "en-US";

  // SSR auth bootstrap.
  // Fetch the current user against the Java content service using the
  // request's `satoken` cookie, then seed the React Query cache so the
  // first client paint already has the logged-in state. This is the
  // fix for the post-login / F5 flash where the navbar briefly
  // rendered the visitor variant before client-side `useUserInfo()`
  // resolved.
  //
  // Scope is intentionally narrow: this is auth *data hydration*, not
  // a redirect gate. Pages that need a logged-in user still decide
  // when to redirect on the client (`useCurrentUser()` + page logic) —
  // SSR's only job is to make sure that decision sees real data, not
  // a cold cache.
  const queryClient = getServerQueryClient();
  const userInfo = await fetchUserInfoServerSide();
  if (userInfo) {
    queryClient.setQueryData(userKeys.info, userInfo);
  }
  const dehydratedState = dehydrate(queryClient);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className="h-full antialiased font-sans dark"
      // Inline background + color-scheme guarantees the page is dark
      // before any CSS bundle (or external Google Fonts CSS link) lands.
      // The theme-init script overrides this when needed; until then the
      // viewport stays dark so the slow-network flash never happens.
      style={{ backgroundColor: "#0c0e14", colorScheme: "dark" }}
    >
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
        {/* Site-wide schema.org JSON-LD — Organization + WebSite.
            Goes inside <head> so it lands in the SSR HTML before
            any client JS, which is what crawlers + AI engines read.
            Page-level structured data (Article / CreativeWork /
            Course / FAQPage / …) is emitted from the page's own
            server component using the same <JsonLd> helper. */}
        <JsonLd data={[buildOrganization(), buildWebSite()]} />
      </head>
      <body className="min-h-full flex flex-col bg-background">
        {/* Top progress bar for App Router navigation. App Router
            blocks URL change until the destination route's RSC
            payload arrives — without feedback, slow page transitions
            (e.g. /ips/[id], /projects/[id]) feel like the click did
            nothing. The bar shows immediately on click and finishes
            when navigation lands. Brand-tinted (amber, matches the
            primary token) + thin (3px) so it doesn't dominate. */}
        <NextTopLoader
          color="#f59e0b"
          height={3}
          showSpinner={false}
          shadow="0 0 10px rgba(245,158,11,0.4)"
        />
        <RootLayoutClient initialLocale={locale} dehydratedState={dehydratedState}>
          {children}
        </RootLayoutClient>
      </body>
    </html>
  );
}
