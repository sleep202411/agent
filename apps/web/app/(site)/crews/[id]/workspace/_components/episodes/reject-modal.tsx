"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

interface RejectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display label for the row being rejected — shown in the dialog
   *  header so the user can sanity-check which submission they're
   *  about to reject. */
  targetLabel: string;
  submitting?: boolean;
  onConfirm: (reason: string, suggestion: string) => void;
}

/**
 * Reusable rejection dialog — used both for rejecting a single member's
 * submission and (potentially) rejecting an entire episode. The reason
 * is required (matches PRD spec) and the suggestion is optional.
 */
export function RejectModal({
  open,
  onOpenChange,
  targetLabel,
  submitting,
  onConfirm,
}: RejectModalProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const [reason, setReason] = useState("");
  const [suggestion, setSuggestion] = useState("");

  useEffect(() => {
    if (open) return;
    setReason("");
    setSuggestion("");
  }, [open]);

  const canSubmit = !submitting && reason.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("rejectTitle")} · {targetLabel}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reject-reason" required>
                {t("rejectReason")}
              </FieldLabel>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("rejectReasonPlaceholder")}
                rows={3}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="reject-suggestion">{t("rejectSuggestion")}</FieldLabel>
              <Textarea
                id="reject-suggestion"
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                placeholder={t("rejectSuggestionPlaceholder")}
                rows={3}
              />
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tc("cancel")}
          </Button>
          <Button
            variant="solid"
            color="destructive"
            disabled={!canSubmit}
            onClick={() => onConfirm(reason.trim(), suggestion.trim())}
          >
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("rejectConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
