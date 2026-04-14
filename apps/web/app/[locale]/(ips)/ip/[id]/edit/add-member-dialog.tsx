import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { useTranslations } from "@/src/i18n/i18n";

const PERMISSIONS = [
  { id: "editProject", labelKey: "permEditProject" },
  { id: "manageCommunity", labelKey: "permManageCommunity" },
  { id: "coordinateRewards", labelKey: "permCoordinateRewards" },
  { id: "managePayments", labelKey: "permManagePayments" },
  { id: "analytics", labelKey: "permAnalytics" },
] as const;

export interface NewMember {
  email: string;
  name: string;
  permissions: string[];
}

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (member: NewMember) => void;
}

export function AddMemberDialog({ open, onOpenChange, onSubmit }: AddMemberDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);

  const reset = () => {
    setEmail("");
    setName("");
    setPermissions([]);
  };

  const togglePermission = (id: string) => {
    setPermissions((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const handleSubmit = () => {
    if (!email.trim()) {
      toast.warning(t("emailRequired"));
      return;
    }
    if (!name.trim()) {
      toast.warning(t("nameRequired"));
      return;
    }
    onSubmit({ email: email.trim(), name: name.trim(), permissions });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addMemberTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <Field>
            <FieldLabel>{t("memberEmail")}</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
            />
          </Field>

          <Field>
            <FieldLabel>{t("memberName")}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("memberNamePlaceholder")}
            />
          </Field>

          <Field>
            <FieldLabel>{t("memberPermissions")}</FieldLabel>
            <FieldDescription>{t("memberPermissionsDesc")}</FieldDescription>
            <div className="mt-2 space-y-2">
              {PERMISSIONS.map((perm) => (
                <label
                  key={perm.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-muted/50"
                >
                  <Checkbox
                    checked={permissions.includes(perm.id)}
                    onCheckedChange={() => togglePermission(perm.id)}
                  />
                  <span className="text-sm">{t(perm.labelKey)}</span>
                </label>
              ))}
            </div>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSubmit}>{t("sendInvite")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
