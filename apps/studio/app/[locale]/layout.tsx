import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "../globals.css";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/app/providers";
import { RegionProvider } from "@/app/_components/region-provider";
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

export const metadata: Metadata = {
  title: "FizzStudio",
  description: "AI creative studio",
};

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
          <Providers>
            <RegionProvider country={country}>
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            </RegionProvider>
            <RouteAuthGuard />
            <SettingsOverlay />
            <NotificationsListener />
          </Providers>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

function detectCountry(headers: Headers) {
  const fromProxy = headers.get("x-country");
  if (fromProxy) return fromProxy.toUpperCase();
  const fromCloudflare = headers.get("cf-ipcountry");
  if (fromCloudflare && fromCloudflare !== "XX") return fromCloudflare.toUpperCase();
  return "US";
}
