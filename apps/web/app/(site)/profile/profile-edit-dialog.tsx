import { useEffect, useState } from "react";
import { IconCheck, IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
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
import { useUpdateUserInfo } from "@/src/hooks/use-user";
import {
  parseEducation,
  serializeEducation,
  type EducationEntry,
  type UserInfo,
} from "@/src/services/user";

interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userInfo: UserInfo | null;
}

const blankEducation = (): EducationEntry => ({
  schoolName: "",
  major: "",
  startDate: "",
  endDate: "",
});

export function ProfileEditDialog({ open, onOpenChange, userInfo }: ProfileEditDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const [nickName, setNickName] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [other, setOther] = useState("");
  const [education, setEducation] = useState<EducationEntry[]>([]);

  const { mutate: updateProfile, isPending } = useUpdateUserInfo();

  // Sync form when dialog opens
  useEffect(() => {
    if (!open) return;
    setNickName(userInfo?.nickName ?? "");
    setContact(userInfo?.contact ?? "");
    setDescription(userInfo?.description ?? "");
    setOther(userInfo?.other ?? "");
    setEducation(parseEducation(userInfo?.study));
  }, [open, userInfo]);

  const updateEducation = (i: number, patch: Partial<EducationEntry>) => {
    setEducation((prev) => prev.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)));
  };

  const addEducation = () => setEducation((prev) => [...prev, blankEducation()]);
  const removeEducation = (i: number) => setEducation((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (!nickName.trim()) {
      toast.warning(t("nicknameRequired"));
      return;
    }
    updateProfile(
      {
        nickName: nickName.trim(),
        contact: contact.trim(),
        description: description.trim(),
        other: other.trim(),
        study: serializeEducation(education),
      },
      {
        onSuccess: () => {
          toast.success(t("updateSuccess"));
          onOpenChange(false);
        },
        onError: () => {
          toast.error(t("updateFailed"));
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editProfile")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <Field>
            <FieldLabel required>{t("nickname")}</FieldLabel>
            <Input
              value={nickName}
              onChange={(e) => setNickName(e.target.value)}
              placeholder={t("enterNickname")}
              maxLength={100}
            />
          </Field>

          <Field>
            <FieldLabel>{t("contact")}</FieldLabel>
            <Textarea
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("enterContact")}
              maxLength={200}
              rows={2}
            />
          </Field>

          <Field>
            <FieldLabel>{t("bio")}</FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("enterBio")}
              maxLength={2000}
              rows={4}
            />
          </Field>

          <Field>
            <FieldLabel>{t("portfolio")}</FieldLabel>
            <Textarea
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={t("enterPortfolio")}
              maxLength={2000}
              rows={3}
            />
          </Field>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel className="mb-0!">{t("education")}</FieldLabel>
              <Button
                type="button"
                variant="outline"
                color="muted"
                size="sm"
                onClick={addEducation}
              >
                <IconPlus className="size-3.5" />
                {t("addEducation")}
              </Button>
            </div>

            {education.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                {t("educationEmpty")}
              </p>
            ) : (
              <div className="space-y-3">
                {education.map((entry, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-md border border-border bg-muted/10 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <Input
                        value={entry.schoolName}
                        onChange={(e) => updateEducation(i, { schoolName: e.target.value })}
                        placeholder={t("schoolName")}
                        maxLength={120}
                      />
                      <button
                        type="button"
                        onClick={() => removeEducation(i)}
                        className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        aria-label={tc("delete")}
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                    <Input
                      value={entry.major}
                      onChange={(e) => updateEducation(i, { major: e.target.value })}
                      placeholder={t("major")}
                      maxLength={120}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="month"
                        value={entry.startDate}
                        onChange={(e) => updateEducation(i, { startDate: e.target.value })}
                        placeholder={t("startDate")}
                      />
                      <Input
                        type="month"
                        value={entry.endDate ?? ""}
                        onChange={(e) => updateEducation(i, { endDate: e.target.value })}
                        placeholder={t("endDateOptional")}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
