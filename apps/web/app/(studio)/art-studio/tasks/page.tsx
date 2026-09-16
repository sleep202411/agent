"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { TaskPanelConnected } from "@/components/workspace/task-panel-connected";

export default function TasksPage() {
  const t = useTranslations("workspace");
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("tasksTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("tasksDescription")}</p>
      </div>

      <TaskPanelConnected />
    </div>
  );
}
