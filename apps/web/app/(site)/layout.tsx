"use client";

import { AuthGate } from "@/components/layout/auth-gate";
import { GlobalNav } from "@/components/layout/global-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { useIsInIframe } from "@/src/hooks/use-is-in-iframe";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // Embedders supply their own chrome — hide nav + footer + the
  // pt-16 nav clearance when this surface is in an iframe.
  const isInIframe = useIsInIframe();

  if (isInIframe) {
    return (
      <AuthGate>
        <main>{children}</main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <GlobalNav />
      <main className="min-h-[calc(100vh-4rem)] pt-16">{children}</main>
      <SiteFooter />
    </AuthGate>
  );
}
