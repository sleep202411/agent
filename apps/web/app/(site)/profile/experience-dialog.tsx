"use client";

import { useEffect, useState } from "react";
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
  company: "",
  location: "",
  startDate: "",
  endDate: "",
  description: "",
};

export function ExperienceDialog({ open, onOpenChange, initial }: ExperienceDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<ExperienceEntry>(EMPTY);
  const { mutateAsync: createEntry, isPending: creating } = useCreateExperience();
  const { mutateAsync: updateEntry, isPending: updating } = useUpdateExperience();
  const isPending = creating || updating;
  const isEditing = !!initial?.id;

  useEffect(() => {
    if (!open) return;
    setDraft(initial ?? EMPTY);
  }, [open, initial]);

  const update = (patch: Partial<ExperienceEntry>) => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = async () => {
    if (!draft.title.trim()) {
      toast.warning(t("experienceTitleRequired"));
      return;
    }
    try {
      if (isEditing) {
        await updateEntry(draft);
      } else {
        await createEntry(draft);
      }
      toast.success(t("updateSuccess"));
      onOpenChange(false);
    } catch {
      toast.error(t("updateFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("editExperience") : t("addExperience")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <Field>
            <FieldLabel required>{t("experienceTitle")}</FieldLabel>
            <Input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={t("experienceTitle")}
              maxLength={120}
            />
          </Field>

          <Field>
            <FieldLabel>{t("experienceCompany")}</FieldLabel>
            <Input
              value={draft.company}
              onChange={(e) => update({ company: e.target.value })}
              placeholder={t("experienceCompany")}
              maxLength={120}
            />
          </Field>

          <Field>
            <FieldLabel>{t("experienceLocation")}</FieldLabel>
            <Input
              value={draft.location}
              onChange={(e) => update({ location: e.target.value })}
              placeholder={t("experienceLocation")}
              maxLength={120}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>{t("startDate")}</FieldLabel>
              <Input
                type="month"
                value={draft.startDate}
                onChange={(e) => update({ startDate: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel>{t("endDateOptional")}</FieldLabel>
              <Input
                type="month"
                value={draft.endDate ?? ""}
                onChange={(e) => update({ endDate: e.target.value })}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>{t("experienceDescription")}</FieldLabel>
            <Textarea
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={t("experienceDescription")}
              rows={4}
              maxLength={2000}
            />
          </Field>
        </div>

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
