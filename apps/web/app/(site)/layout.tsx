import { headers } from "next/headers";
import { AuthGate } from "@/components/layout/auth-gate";
import { GlobalNav } from "@/components/layout/global-nav";
import { SiteFooter } from "@/components/layout/site-footer";

/** The mobile app's AuthedWebView appends this marker to the WebView
 *  user agent (`applicationNameForUserAgent`). Embedded pages drop the
 *  web chrome — the native shell provides its own header, and the web
 *  nav/footer would just let users wander out of the embedded surface. */
const APP_WEBVIEW_UA_MARKER = "FizzDragonApp";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const userAgent = (await headers()).get("user-agent") ?? "";
  const embedded = userAgent.includes(APP_WEBVIEW_UA_MARKER);

  if (embedded) {
    return (
      <AuthGate>
        <main className="min-h-screen">{children}</main>
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
