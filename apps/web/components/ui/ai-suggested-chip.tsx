import { IconSparkles } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Small violet chip that signals a form field was prefilled by an AI
 * suggestion (Spark / scriptwriter / world-creation analyzer). Drop it
 * next to a `<FieldLabel>` (it's a `w-fit` flex container, so the label
 * keeps its own sizing).
 *
 *     <FieldLabel required>
 *       {t("fieldName")}
 *       {aiFilled && <AiSuggestedChip label={t("aiSuggested")} />}
 *     </FieldLabel>
 *
 * Was previously duplicated as a private helper in three dialogs
 * (create-ip / spark / create-world); promoted here once the third copy
 * showed up.
 */
export function AiSuggestedChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/10 px-1.5 py-px text-[10px] font-medium text-violet-300",
        className
      )}
    >
      <IconSparkles className="size-2.5" />
      {label}
    </span>
  );
}
