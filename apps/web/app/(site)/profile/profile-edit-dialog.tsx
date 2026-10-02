import { useLayoutEffect, useRef, useState } from "react";
import { IconCamera, IconCheck, IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/src/i18n/i18n";
import { useUpdateUserInfo, useUploadAvatar } from "@/src/hooks/use-user";
import {
  parseEducation,
  serializeEducation,
  type EducationEntry,
  type UserInfoResolved,
} from "@/src/services/user";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userInfo: UserInfoResolved | null;
}

const blankEducation = (): EducationEntry => ({
  schoolName: "",
  major: "",
  startDate: "",
  endDate: "",
});

export function ProfileEditDialog(props: ProfileEditDialogProps) {
  return <ProfileEditSession key={JSON.stringify([props.open, props.userInfo?.id])} {...props} />;
}

function ProfileEditSession({ open, onOpenChange, userInfo }: ProfileEditDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  // Snapshot fields for this editing session. Avatar/query refreshes must not
  // replace unsaved text; reopening or switching accounts starts a fresh draft.
  const [nickName, setNickName] = useState(userInfo?.nickName ?? "");
  const [contact, setContact] = useState(userInfo?.contact ?? "");
  const [description, setDescription] = useState(userInfo?.description ?? "");
  const [other, setOther] = useState(userInfo?.other ?? "");
  const [education, setEducation] = useState<EducationEntry[]>(() =>
    parseEducation(userInfo?.study)
  );
  const active = useRef(open);
  useLayoutEffect(() => {
    active.current = open;
    return () => {
      active.current = false;
    };
  }, [open]);

  const { mutate: updateProfile, isPending } = useUpdateUserInfo();
  const uploadAvatar = useUploadAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = uploadAvatar.isPending;

  // useUploadAvatar invalidates the user-info query on success, so the
  // <UserAvatar> re-renders from the fresh `userInfo.headImgUrl`
  // without any local "pending" state needed.
  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("pleaseUploadImage"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(t("avatarSizeLimit"));
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
      if (active.current) toast.success(t("avatarUpdated"));
    } catch (err) {
      if (!active.current) return;
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("avatarUploadFailed"));
    }
  };

  const updateEducation = (i: number, patch: Partial<EducationEntry>) => {
    setEducation((prev) => prev.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)));
  };

  const addEducation = () => setEducation((prev) => [...prev, blankEducation()]);
  const removeEducation = (i: number) => setEducation((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (isPending || !active.current) return;
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
          if (!active.current) return;
          toast.success(t("updateSuccess"));
          onOpenChange(false);
        },
        onError: (error) => {
          if (!active.current) return;
          toast.error(error instanceof Error && error.message ? error.message : t("updateFailed"));
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
          {/* Avatar slot — click anywhere on the avatar to pick a new
              image. Hover overlay matches the nickname-required-dialog
              pattern so the affordance is consistent. Upload commits
              immediately (independent of the Save button) since the
              upload endpoint is separate from the profile update. */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => !uploading && fileInputRef.current?.click()}
              disabled={uploading}
              aria-label={t("avatarChange")}
              className="group relative size-20 shrink-0 overflow-hidden rounded-full outline-none ring-1 ring-border transition-all hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
            >
              <UserAvatar
                src={userInfo?.headImgUrl}
                seed={userInfo?.id}
                name={userInfo?.nickName ?? userInfo?.userName}
                className="size-20"
              />
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity",
                  uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                {uploading ? (
                  <IconLoader2 className="size-6 animate-spin text-white" />
                ) : (
                  <IconCamera className="size-6 text-white" />
                )}
              </div>
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{t("avatarChange")}</div>
              <p className="mt-1 text-xs text-muted-foreground">{t("avatarHint")}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>

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
