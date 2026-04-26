import { GlobalNav } from "@/components/layout/global-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GlobalNav />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
