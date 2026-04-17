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
import { useUpdateUserInfo } from "@/src/hooks/use-user";
import type { UserInfo } from "@/src/services/user";

interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userInfo: UserInfo | null;
}

export function ProfileEditDialog({ open, onOpenChange, userInfo }: ProfileEditDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const [nickName, setNickName] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [other, setOther] = useState("");

  const { mutate: updateProfile, isPending } = useUpdateUserInfo();

  // Sync form when dialog opens
  useEffect(() => {
    if (!open) return;
    setNickName(userInfo?.nickName ?? "");
    setContact(userInfo?.contact ?? "");
    setDescription(userInfo?.description ?? "");
    setOther(userInfo?.other ?? "");
  }, [open, userInfo]);

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
