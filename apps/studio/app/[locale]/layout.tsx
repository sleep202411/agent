import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "../globals.css";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/app/providers";
import { RegionProvider, type SiteRegion } from "@/app/_components/region-provider";
import { NotificationsListener } from "@/app/_components/notifications-listener";
import { RouteAuthGuard } from "@/app/_components/route-auth-guard";
import { SettingsOverlay } from "./_components/settings-overlay";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("studioTitle"),
    description: t("studioDescription"),
  };
}

export const viewport: Viewport = {
  colorScheme: "dark",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const headerBag = await headers();
  const country = detectCountry(headerBag);
  const siteRegion = detectSiteRegion();

  return (
    <html
      lang={locale}
      className={cn(
        "dark h-full antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {/* RegionProvider must wrap Providers: AuthProvider (inside Providers)
              renders the global LoginDialog, and its buildWebHref() links read
              useSiteRegion(). Nested the other way the dialog sits ABOVE this
              provider and falls back to the "global" context default — sending
              the dialog's legal links to .com on the .cn cell. */}
          <RegionProvider country={country} siteRegion={siteRegion}>
            <Providers>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
              {/* SettingsOverlay renders the billing panel, which reads
                  useIsCnSite() for cell-aware pricing — still inside RegionProvider. */}
              <RouteAuthGuard />
              <SettingsOverlay />
              <NotificationsListener />
            </Providers>
          </RegionProvider>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

// The deployment cell, read from RUNTIME pod env here on the server (this layout is
// dynamic — it reads headers) and handed to the client via RegionProvider. Uses the
// non-public `SITE_REGION`: Next.js compile-time-inlines every `NEXT_PUBLIC_*` (even
// server-side), and the studio image bakes none, so only a runtime var works. `cn`
// on the .cn deployment; `global` everywhere else.
function detectSiteRegion(): SiteRegion {
  const raw = process.env.SITE_REGION ?? process.env.NEXT_PUBLIC_SITE_REGION ?? "global";
  return raw === "cn" ? "cn" : "global";
}

function detectCountry(headers: Headers) {
  const fromProxy = headers.get("x-country");
  if (fromProxy) return fromProxy.toUpperCase();
  const fromCloudflare = headers.get("cf-ipcountry");
  if (fromCloudflare && fromCloudflare !== "XX") return fromCloudflare.toUpperCase();
  return "US";
}
