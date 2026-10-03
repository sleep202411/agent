"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";

export function CourseLoadError({
  error,
  retry,
  busy,
}: {
  error: unknown;
  retry?: () => void;
  busy: boolean;
}) {
  const t = useTranslations("courses");
  const common = useTranslations("common");
  return (
    <Alert variant="destructive" className="max-w-xl border-border bg-card">
      <IconAlertCircle />
      <AlertTitle>{t("loadFailedTitle")}</AlertTitle>
      <AlertDescription>
        <p className="break-words">
          {error instanceof Error && error.message ? error.message : t("loadFailedDescription")}
        </p>
        {retry && (
          <Button type="button" variant="outline" size="sm" onClick={retry} disabled={busy}>
            {common("retry")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
