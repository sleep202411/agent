import { setRequestLocale } from "next-intl/server";
import { HblnDemoClient } from "./hbln-demo-client";
import release from "./hbln-release.json";

// Standalone fullscreen-immersive 影游 demo of "虎豹别墅：龙口入夜".
// Public route (/hbln-demo), not auth-gated.
export default async function HblnDemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HblnDemoClient release={release as Record<string, unknown>} locale={locale} />;
}
