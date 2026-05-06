"use client";

import type { Icon } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

interface StepHeaderProps {
  icon: Icon;
  titleKey: string;
  descriptionKey: string;
}

/**
 * Per-step intro block — icon + title + one-line description. Sits at
 * the top of every step page; the rest of the page is step-specific
 * (script summary + episode list, asset tabs, video timeline, etc.).
 */
export function StepHeader({ icon: Icon, titleKey, descriptionKey }: StepHeaderProps) {
  const t = useTranslations("produce");
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-md bg-muted">
        <Icon className="size-5" />
      </span>
      <div>
        <h2 className="text-lg font-semibold">{t(titleKey)}</h2>
        <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
      </div>
    </div>
  );
}
