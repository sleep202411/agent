"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A failed save must remain visible until the provider confirms recovery. */
export function DocumentSyncError({
  error,
  retry,
  retrying,
  className,
}: {
  error: string | null;
  retry: (() => void) | null;
  retrying: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  if (!error) return null;
  return (
    <div className={cn("flex items-center gap-3 rounded-xl bg-popover px-4 py-3", className)}>
      <p role="alert" className="min-w-0 flex-1 text-sm break-words text-foreground">
        {error}
      </p>
      {retry && (
        <Button variant="secondary" size="sm" disabled={retrying} onClick={retry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
