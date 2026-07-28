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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { isWebUrl } from "./deliverable-url";

interface SubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display label for the row being submitted — same header shape as
   *  the reject dialog, so the member can confirm which slot this is. */
  targetLabel: string;
  /** Rejected work re-enters through this same form; only the wording
   *  changes. */
  resubmit?: boolean;
  submitting?: boolean;
  /** Verbatim server message from the previous failed attempt. Kept
   *  inline (rather than only in a toast) because the fix is usually in
   *  this form — a rejected link, a removed membership — and closing the
   *  dialog would throw away everything typed. */
  errorMessage?: string | null;
  onConfirm: (url: string, note: string) => void;
}

/**
 * Column caps from `SubmitAssignmentSchema`
 * (apps/server/src/crews/episodes/dto.ts). Enforced at the keystroke so
 * a pasted signed URL — those run long — can never come back as a 400;
 * the inline notice below keeps the truncation from being silent.
 */
const URL_MAX_LENGTH = 1024;
const NOTE_MAX_LENGTH = 2000;

/**
 * Deliverable submission form for one assignment.
 *
 * Shape mirrors `RejectModal`: the dialog owns the fields, the caller
 * owns the mutation and feeds `submitting` / `errorMessage` back down.
 *
 * A submission must carry content — the server requires at least one of
 * {url, note}, because a status flip with nothing attached leaves the
 * reviewer with nothing to look at.
 */
export function SubmitDialog({
  open,
  onOpenChange,
  targetLabel,
  resubmit,
  submitting,
  errorMessage,
  onConfirm,
}: SubmitDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) return;
    setUrl("");
    setNote("");
  }, [open]);

  const trimmedUrl = url.trim();
  const trimmedNote = note.trim();
  const urlInvalid = trimmedUrl.length > 0 && !isWebUrl(trimmedUrl);
  const urlMaxed = url.length >= URL_MAX_LENGTH;
  const noteMaxed = note.length >= NOTE_MAX_LENGTH;
  const canSubmit = !submitting && !urlInvalid && (trimmedUrl.length > 0 || trimmedNote.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {resubmit ? t("resubmit") : t("submitForReview")} · {targetLabel}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="submit-url">{t("submitUrl")}</FieldLabel>
              <Input
                id="submit-url"
                type="url"
                inputMode="url"
                maxLength={URL_MAX_LENGTH}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("submitUrlPlaceholder")}
              />
              {urlInvalid ? <FieldError>{t("submitUrlInvalid")}</FieldError> : null}
              {!urlInvalid && urlMaxed ? (
                <FieldDescription>
                  {t("submitLengthCapped", { max: URL_MAX_LENGTH })}
                </FieldDescription>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="submit-note">{t("submitNote")}</FieldLabel>
              <Textarea
                id="submit-note"
                maxLength={NOTE_MAX_LENGTH}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("submitNotePlaceholder")}
                rows={4}
              />
              <FieldDescription>
                {noteMaxed ? t("submitLengthCapped", { max: NOTE_MAX_LENGTH }) : t("submitHint")}
              </FieldDescription>
            </Field>
            {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tc("cancel")}
          </Button>
          <Button
            variant="solid"
            color="primary"
            disabled={!canSubmit}
            onClick={() => onConfirm(trimmedUrl, trimmedNote)}
          >
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("submitConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
