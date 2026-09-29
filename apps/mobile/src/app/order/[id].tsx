import { useLocalSearchParams } from "expo-router";
import { AuthedWebView } from "@/components/authed-web-view";
import { useTranslations } from "@/i18n";
export default function OrderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations();
  return (
    <AuthedWebView
      path={typeof id === "string" && id ? `/orders/${encodeURIComponent(id)}` : "/orders"}
      title={t("serviceOrder.open")}
    />
  );
}
