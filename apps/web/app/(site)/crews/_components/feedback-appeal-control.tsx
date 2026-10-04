"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { usePrivateCaseWrite } from "../_hooks/use-private-case-write";

/** The parent only mounts this for the authenticated feedback subject. */
export function FeedbackAppealControl({
  feedbackId,
  userId,
}: {
  feedbackId: string;
  userId: string;
}) {
  const t = useTranslations("crewCases");
  const locale = useLocale();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const mutation = usePrivateCaseWrite<{ feedbackId: string; dispute: { id: string } }>(
    async () => client.invalidateQueries({ queryKey: ["crew-cases", userId] }),
    t("failed")
  );
  const disabled = mutation.busy || Boolean(mutation.retry) || Boolean(mutation.saved);
  return (
    <section className="space-y-2 pt-2" aria-label={t("appealFeedback")}>
      <p className="text-sm text-muted-foreground">{t("appealExplanation")}</p>
      <Link className="text-primary underline" href={`/${locale}/resolution-center`}>
        {t("existingCases")}
      </Link>
      {mutation.error && <p role="alert">{mutation.error}</p>}
      {mutation.saved ? (
        <div role="status">
          <p>{t("appealSaved")}</p>
          <Link
            className="text-primary underline"
            href={`/${locale}/resolution-center/${encodeURIComponent(mutation.saved.dispute.id)}`}
          >
            {t("viewCase")}
          </Link>
        </div>
      ) : (
        <>
          <label className="block">
            {t("reason")}
            <Textarea
              maxLength={1000}
              disabled={disabled}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {mutation.retry ? (
            <>
              <p>{t("retryHelp")}</p>
              <Button
                disabled={mutation.busy}
                onClick={() => void mutation.send(mutation.retry!, true)}
              >
                {t("retryWrite")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              disabled={disabled || reason.trim().length < 3}
              onClick={() => {
                if (!disabled && reason.trim().length >= 3 && reason.trim().length <= 1000)
                  void mutation.send({
                    path: `/crew-task-feedback/${encodeURIComponent(feedbackId)}/appeals`,
                    body: { id: crypto.randomUUID(), reason: reason.trim() },
                  });
              }}
            >
              {t("appealFeedback")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
