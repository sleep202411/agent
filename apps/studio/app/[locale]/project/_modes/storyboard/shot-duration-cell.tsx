"use client";

import { useTranslations } from "next-intl";
import { useTextDraft } from "@/lib/use-text-draft";
import { cn } from "@/lib/utils";

const QUIET_CELL =
  "-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-white/[0.05] focus-within:bg-white/[0.06]";

/** Seconds — stored as a number, shown with its unit only once it has one. */
export function ShotDurationCell({
  value,
  ariaLabel,
  readOnly,
  onCommit,
}: {
  value: number | undefined;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: number | undefined) => void;
}) {
  const t = useTranslations("storyboard");
  const draft = useTextDraft(value == null ? "" : String(value), (next) => {
    const parsed = Number.parseFloat(next.replace(",", "."));
    onCommit(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  });

  if (readOnly) {
    return (
      <span className="text-xs/relaxed tabular-nums text-white/75">
        {value == null ? (
          <span className="text-white/25">—</span>
        ) : (
          t("cell.durationValue", { seconds: value })
        )}
      </span>
    );
  }
  return (
    <span className={cn(QUIET_CELL, "inline-flex items-baseline gap-0.5 py-1")}>
      <input
        value={draft.value}
        onChange={(event) => draft.onChange(event.target.value)}
        onBlur={draft.flush}
        inputMode="decimal"
        placeholder="—"
        aria-label={ariaLabel}
        className="w-7 bg-transparent text-xs/relaxed tabular-nums text-white/85 outline-none placeholder:text-white/25"
      />
      {draft.value ? (
        <span className="text-[10px] text-white/35">{t("cell.durationUnit")}</span>
      ) : null}
    </span>
  );
}
