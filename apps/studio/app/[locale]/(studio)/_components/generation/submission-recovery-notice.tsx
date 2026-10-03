"use client";
import { useTranslations } from "next-intl";
export interface SubmissionRecovery {
  pending: boolean;
  prompt?: string;
  checking: boolean;
  error: string | null;
  canRetry: boolean;
  check: () => Promise<void>;
  retryOriginal: () => Promise<void>;
}
export function SubmissionRecoveryNotice({ recovery }: { recovery?: SubmissionRecovery }) {
  const t = useTranslations("generationSubmission");
  if (!recovery?.pending) return null;
  return (
    <div role="status" className="mb-3 rounded-xl bg-muted p-3 text-sm text-foreground">
      <p>{t("pending")}</p>
      {recovery.prompt ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{recovery.prompt}</p>
      ) : null}
      {recovery.error ? (
        <p className="mt-2 text-xs text-muted-foreground">{recovery.error}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={recovery.checking}
          onClick={() => void recovery.check()}
          className="rounded-lg bg-secondary px-3 py-2 text-xs disabled:opacity-50"
        >
          {recovery.checking ? t("checking") : t("check")}
        </button>
        {recovery.canRetry ? (
          <button
            type="button"
            disabled={recovery.checking}
            onClick={() => void recovery.retryOriginal()}
            className="rounded-lg bg-secondary px-3 py-2 text-xs disabled:opacity-50"
          >
            {t("retryOriginal")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
