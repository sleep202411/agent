"use client";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewTaskStatus } from "@/app/(site)/crews/_hooks/types";

export function TaskDeliveryProgress({ status }: { status: CrewTaskStatus }) {
  const t = useTranslations("crewTaskDeliveryLayout");
  const labels = ["work", "submit", "decision"] as const;
  const current =
    status === "approved" || status === "revision_requested" ? 2 : status === "submitted" ? 1 : 0;
  return (
    <nav aria-label={t("progress")} className="border-b border-white/10 px-5 py-4">
      {status === "cancelled" ? (
        <p className="text-sm text-muted-foreground">{t("cancelled")}</p>
      ) : (
        <ol className="mx-auto flex max-w-2xl items-center gap-3">
          {labels.map((label, index) => (
            <li
              key={label}
              aria-current={index === current ? "step" : undefined}
              className="flex flex-1 items-center gap-2 text-xs"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full ${index <= current ? "bg-[#E52227] text-white" : "bg-white/5 text-muted-foreground"}`}
              >
                {index + 1}
              </span>
              <span>
                {t(index === 0 && status === "open" ? "notStarted" : label)}
                {index === 2 && status === "revision_requested"
                  ? ` · ${t("revision")}`
                  : index === 2 && status === "approved"
                    ? ` · ${t("approved")}`
                    : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
