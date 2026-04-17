"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { TARGET_EPISODES_OPTIONS, type IPCreateForm } from "@/app/(ips)/_components/ip-mock";

interface Props {
  form: IPCreateForm;
  update: (patch: Partial<IPCreateForm>) => void;
}

export function StepStory({ form, update }: Props) {
  const t = useTranslations("ipCreate");
  const storyMinChars = 30;
  const storyOk = form.story.length >= storyMinChars;

  return (
    <div className="space-y-6">
      {/* Story */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("storySummary")} <span className="text-destructive">*</span>
        </label>
        <textarea
          value={form.story}
          onChange={(e) => update({ story: e.target.value.slice(0, 2000) })}
          placeholder={t("storyPlaceholder")}
          rows={6}
          className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className={cn("text-xs", storyOk ? "text-green-400" : "text-amber-400")}>
            {storyOk
              ? t("storyMinMet")
              : t("storyMinNeeded", { count: storyMinChars - form.story.length })}
          </span>
          <span className="text-xs text-muted-foreground">{form.story.length}/2000</span>
        </div>
      </div>

      {/* Why This IP */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("whyThisIP")} <span className="text-destructive">*</span>
        </label>
        <textarea
          value={form.whyThisIP}
          onChange={(e) => update({ whyThisIP: e.target.value.slice(0, 1000) })}
          placeholder={t("whyPlaceholder")}
          rows={4}
          className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-1.5 text-right text-xs text-muted-foreground">
          {form.whyThisIP.length}/1000
        </div>
      </div>

      {/* Target episodes */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("targetEpisodes")}
        </label>
        <div className="flex flex-wrap gap-2">
          {TARGET_EPISODES_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => update({ targetEpisodes: n })}
              className={cn(
                "rounded-lg border px-4 py-2 text-xs font-medium transition-all",
                form.targetEpisodes === n
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {n} {t("epsUnit")}
            </button>
          ))}
        </div>
      </div>

      {/* Info tip */}
      <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">{t("storyTip")}</p>
      </div>
    </div>
  );
}
