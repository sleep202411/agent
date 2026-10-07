"use client";
import { CURRENT_TASK_PAYMENT_TERMS } from "@repo/shared/crew";
import { IconHelpCircle } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslations } from "@/src/i18n/i18n";
export function TaskPaymentHelp() {
  const t = useTranslations("taskPaymentTerms");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("help")}
            className="inline-flex size-8 items-center justify-center rounded focus-visible:outline focus-visible:outline-primary"
          >
            <IconHelpCircle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm space-y-3">
          {CURRENT_TASK_PAYMENT_TERMS.map((term) => (
            <p key={term}>
              <strong>{t(term)}</strong>
              <br />
              {t(`${term}Help`)}
            </p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
