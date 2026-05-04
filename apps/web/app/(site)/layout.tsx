import { AuthGate } from "@/components/layout/auth-gate";
import { GlobalNav } from "@/components/layout/global-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <GlobalNav />
      <main className="min-h-[calc(100vh-4rem)] pt-16">{children}</main>
      <SiteFooter />
    </AuthGate>
  );
}
