"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import {
  useCreateExperience,
  useUpdateExperience,
  type ExperienceEntry,
} from "./_hooks/use-profile-extras";

interface ExperienceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing entry being edited; null = create flow. */
  initial: ExperienceEntry | null;
}

const EMPTY: ExperienceEntry = {
  title: "",
  organization: "",
  location: "",
  startTime: "",
  endTime: "",
  description: "",
};

export function ExperienceDialog(props: ExperienceDialogProps) {
  const { user } = useCurrentUser();
  if (!user) return null;
  return (
    <ExperienceEditSession
      key={JSON.stringify([props.open, user.id, props.initial?.id])}
      {...props}
    />
  );
}

function ExperienceEditSession({ open, onOpenChange, initial }: ExperienceDialogProps) {
  const formId = useId();
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<ExperienceEntry>(() => ({ ...EMPTY, ...initial }));
  const { mutateAsync: createEntry, isPending: creating } = useCreateExperience();
  const { mutateAsync: updateEntry, isPending: updating } = useUpdateExperience();
  const isPending = creating || updating;
  const isEditing = initial?.id !== undefined;
  const active = useRef(false);
  const submitting = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const update = (patch: Partial<ExperienceEntry>) => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = async () => {
    if (submitting.current || !active.current) return;
    if (!draft.title.trim()) {
      toast.warning(t("experienceTitleRequired"));
      return;
    }
    submitting.current = true;
    try {
      if (isEditing) {
        await updateEntry(draft);
      } else {
        await createEntry(draft);
      }
      if (!active.current) return;
      toast.success(t("updateSuccess"));
      onOpenChange(false);
    } catch (err) {
      if (active.current)
        toast.error(err instanceof Error && err.message.trim() ? err.message : t("updateFailed"));
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting.current) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("editExperience") : t("addExperience")}</DialogTitle>
        </DialogHeader>

        <fieldset disabled={isPending} className="space-y-4 p-4">
          <Field>
            <FieldLabel required htmlFor={`${formId}-title`}>
              {t("experienceTitle")}
            </FieldLabel>
            <Input
              id={`${formId}-title`}
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={t("experienceTitle")}
              maxLength={120}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${formId}-organization`}>{t("experienceCompany")}</FieldLabel>
            <Input
              id={`${formId}-organization`}
              value={draft.organization}
              onChange={(e) => update({ organization: e.target.value })}
              placeholder={t("experienceCompany")}
              maxLength={120}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${formId}-location`}>{t("experienceLocation")}</FieldLabel>
            <Input
              id={`${formId}-location`}
              value={draft.location}
              onChange={(e) => update({ location: e.target.value })}
              placeholder={t("experienceLocation")}
              maxLength={120}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor={`${formId}-startTime`}>{t("startDate")}</FieldLabel>
              <Input
                type="date"
                id={`${formId}-startTime`}
                value={draft.startTime}
                onChange={(e) => update({ startTime: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-endTime`}>{t("endDateOptional")}</FieldLabel>
              <Input
                type="date"
                id={`${formId}-endTime`}
                value={draft.endTime ?? ""}
                onChange={(e) => update({ endTime: e.target.value })}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor={`${formId}-description`}>{t("experienceDescription")}</FieldLabel>
            <Textarea
              id={`${formId}-description`}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={t("experienceDescription")}
              rows={4}
              maxLength={2000}
            />
          </Field>
        </fieldset>

        <DialogFooter>
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconCheck className="size-3.5" />
            )}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
