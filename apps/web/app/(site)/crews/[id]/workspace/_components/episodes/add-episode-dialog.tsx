"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useCreateEpisode } from "@/app/(site)/crews/_hooks/use-episodes";

interface AddEpisodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  /** Next episode number — shown read-only in the header so the admin
   *  knows they're creating EP4 / EP5 / etc. */
  nextNumber: number;
}

export function AddEpisodeDialog({
  open,
  onOpenChange,
  crewId,
  nextNumber,
}: AddEpisodeDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");

  const create = useCreateEpisode(crewId);
  const submitting = create.isPending;

  useEffect(() => {
    if (open) return;
    setTitle("");
    setDescription("");
    setDeadline("");
  }, [open]);

  const handleSubmit = () => {
    if (submitting) return;
    create.mutate(
      {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        deadline: deadline || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("episodeCreated", { number: nextNumber }));
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : t("episodeCreateFailed"));
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addEpisodeTitle", { number: nextNumber })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ep-title">{t("episodeTitleField")}</FieldLabel>
              <Input
                id="ep-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("episodeTitlePlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ep-deadline">{t("episodeDeadline")}</FieldLabel>
              <Input
                id="ep-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ep-description">{t("episodeDescriptionField")}</FieldLabel>
              <Textarea
                id="ep-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("episodeDescriptionPlaceholder")}
                rows={3}
              />
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tc("cancel")}
          </Button>
          <Button variant="solid" color="primary" disabled={submitting} onClick={handleSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("addEpisodeConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
