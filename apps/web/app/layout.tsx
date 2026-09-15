import type { Metadata } from "next";
import { headers } from "next/headers";
import { dehydrate } from "@tanstack/react-query";
import NextTopLoader from "nextjs-toploader";
import { AxonRouteTracker } from "@/components/analytics/axon-route-tracker";
import { RootLayoutClient } from "@/app/root-layout-client";
import { getServerQueryClient } from "@/src/lib/react-query/server";
import { fetchUserInfoServerSide } from "@/src/lib/auth/server-user";
import { userKeys } from "@/src/hooks/user-keys";
import { CANONICAL_HOST, JsonLd, buildOrganization, buildWebSite } from "@/src/lib/seo";
import { detectCountry } from "@/src/lib/region/country";
import { RegionProvider } from "@/src/lib/region/provider";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale is resolved by proxy.ts and attached to the request via x-locale header.
  const headerBag = await headers();
  const locale = headerBag.get("x-locale") ?? "en-US";
  // Country normalized by proxy.ts from edge headers (CF / Azure FD /
  // Vercel). Used by RegionProvider to drive country-gated features
  // — see src/lib/region/features.ts.
  const country = detectCountry(headerBag);

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
  const userInfo = await fetchUserInfoServerSide(locale);
  if (userInfo) {
    queryClient.setQueryData(userKeys.infoOf(locale), userInfo);
  }
  const dehydratedState = dehydrate(queryClient);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className="h-full antialiased font-sans dark"
      // FizzDragon web is dark-only. Keep the server-rendered root dark
      // before any CSS bundle or font stylesheet lands.
      style={{ backgroundColor: "#0c0e14", colorScheme: "dark" }}
    >
      <head>
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
        <AxonRouteTracker />
        <RegionProvider country={country}>
          <RootLayoutClient initialLocale={locale} dehydratedState={dehydratedState}>
            {children}
          </RootLayoutClient>
        </RegionProvider>
      </body>
    </html>
  );
}
