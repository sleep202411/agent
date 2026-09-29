import { AuthedWebView } from "@/components/authed-web-view";
import { useTranslations } from "@/i18n";

/** Reuse the account-scoped application, interview, terms and amendment workflow. */
export default function CrewApplicationsScreen() {
  const t = useTranslations();
  return <AuthedWebView path="/crews/applications" title={t("crewDetail.applicationsAction")} />;
}
