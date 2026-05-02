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
import { Field, FieldLabel } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";
import {
  SOCIAL_PLATFORMS,
  useCreateSocial,
  useUpdateSocial,
  type SocialLink,
  type SocialPlatform,
} from "./_hooks/use-profile-extras";

interface SocialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing entry being edited; null = create flow. */
  initial: SocialLink | null;
}

const EMPTY: SocialLink = { platform: SOCIAL_PLATFORMS[0]!.id, url: "" };

export function SocialDialog({ open, onOpenChange, initial }: SocialDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<SocialLink>(EMPTY);
  const { mutateAsync: createEntry, isPending: creating } = useCreateSocial();
  const { mutateAsync: updateEntry, isPending: updating } = useUpdateSocial();
  const isPending = creating || updating;
  const isEditing = !!initial?.id;

  useEffect(() => {
    if (!open) return;
    setDraft(initial ?? EMPTY);
  }, [open, initial]);

  const meta = SOCIAL_PLATFORMS.find((p) => p.id === draft.platform) ?? SOCIAL_PLATFORMS[0]!;

  const handleSave = async () => {
    if (!draft.url.trim()) {
      toast.warning(t("socialUrlRequired"));
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("editSocial") : t("addSocial")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <Field>
            <FieldLabel required>{t("socialPlatformLabel")}</FieldLabel>
            <select
              value={draft.platform}
              onChange={(e) =>
                setDraft((d) => ({ ...d, platform: e.target.value as SocialPlatform }))
              }
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.labelKey)}
                </option>
              ))}
            </select>
          </Field>

          <Field>
            <FieldLabel required>{t("socialUrl")}</FieldLabel>
            <Input
              value={draft.url}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder={meta.placeholder}
              maxLength={500}
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
