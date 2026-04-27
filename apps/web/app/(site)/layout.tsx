"use client";

import { GlobalNav } from "@/components/layout/global-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { useIsInIframe } from "@/src/hooks/use-is-in-iframe";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // Embedders supply their own chrome — hide nav + footer + the
  // pt-16 nav clearance when this surface is in an iframe.
  const isInIframe = useIsInIframe();

  if (isInIframe) {
    return <main>{children}</main>;
  }

  return (
    <>
      <GlobalNav />
      <main className="pt-16">{children}</main>
      <SiteFooter />
    </>
  );
}
