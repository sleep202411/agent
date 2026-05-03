"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";

// FAQ-specific banner artwork on the static CDN — Van Gogh-style
// starry-night painting with question-mark speech bubbles + film reel
// and projector beam (generated 2026-04-30).
const FAQ_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 12_47_51.png"
);

export interface FaqDraft {
  question: string;
  answer: string;
}

const EMPTY_DRAFT: FaqDraft = { question: "", answer: "" };

interface FaqDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: FaqDraft | null;
  /** -1 = creating; >=0 = editing existing row index. */
  index: number | null;
  /**
   * Resolve to close the dialog; reject (or throw) to keep it open and
   * surface the error message inline. Mirrors react-query's
   * `mutateAsync` semantics so the parent can pass it through directly.
   */
  onSubmit: (draft: FaqDraft) => Promise<void>;
}

export function FaqDialog({ open, onOpenChange, initial, index, onSubmit }: FaqDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<FaqDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial ?? EMPTY_DRAFT);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open, initial]);

  const update = (patch: Partial<FaqDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (submitError) setSubmitError(null);
  };

  const handleSave = async () => {
    const question = draft.question.trim();
    const answer = draft.answer.trim();
    if (!question || !answer) {
      setSubmitError(t("faqRequireBoth"));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({ question, answer });
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error && err.message ? err.message : tc("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const isEditing = index !== null && index >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={FAQ_HERO_URL}
          eyebrow={t("faqHeroEyebrow")}
          title={isEditing ? t("faqDialogTitleEdit") : t("faqDialogTitleNew")}
          description={t("faqHeroSubtitle")}
        />

        <DialogBody className="py-4">
          <Field>
            <FieldLabel>
              {t("faqQuestion")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              value={draft.question}
              onChange={(e) => update({ question: e.target.value })}
              placeholder={t("faqQuestionPlaceholder")}
              autoFocus
            />
            <FieldDescription>{t("faqQuestionHelp")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>
              {t("faqAnswer")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Textarea
              value={draft.answer}
              onChange={(e) => update({ answer: e.target.value })}
              placeholder={t("faqAnswerPlaceholder")}
              rows={5}
            />
            <FieldDescription>{t("faqAnswerHelp")}</FieldDescription>
          </Field>
        </DialogBody>

        <DialogFooter className="sm:items-center">
          {submitError && (
            <p className="mr-auto text-xs text-destructive sm:max-w-[60%]">{submitError}</p>
          )}
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
