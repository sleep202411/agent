import { useLocalSearchParams } from "expo-router";
import { AuthedWebView } from "@/components/authed-web-view";
import { useTranslations } from "@/i18n";
/** Existing conversation UI remains the continuation surface until native inbox parity. */
export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations();
  return (
    <AuthedWebView
      path={typeof id === "string" && id ? `/messages/${encodeURIComponent(id)}` : "/messages"}
      title={t("serviceContact.open")}
    />
  );
}
