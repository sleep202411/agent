"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { CrewSectionNavigation } from "../_components/crew-section-navigation";
import { TaskFeedbackPanel } from "../_components/task-feedback-panel";

export default function MyTaskFeedbackPage() {
  const { user, isLoading } = useCurrentUser();
  const t = useTranslations("crewFeedback");
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-6">
      <CrewSectionNavigation active="feedback" />
      <h1 className="mb-4 text-xl font-semibold">{t("history")}</h1>
      {isLoading ? <p>{t("loading")}</p> : user ? <TaskFeedbackPanel /> : <p>{t("signIn")}</p>}
    </main>
  );
}
