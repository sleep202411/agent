import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/app/providers";
import { RegionProvider } from "@/app/_components/region-provider";
import { BetaNotice } from "@/app/_components/beta-notice";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerBag = await headers();
  const country = detectCountry(headerBag);

  return (
    <html
      lang="en"
      className={cn(
        "dark h-full antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <RegionProvider country={country}>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </RegionProvider>
          <BetaNotice />
        </Providers>
        <Toaster />
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
