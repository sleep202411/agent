import { useRef, useState } from "react";
import { IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/src/i18n/i18n";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { api } from "@/src/lib/api";
import {
  useMyCertifications,
  useCertificationRoles,
  useSubmitCertification,
  useUpdateCertification,
} from "@/src/hooks/use-certification";
import { AUTH_STATUS, type Certification } from "@/src/services/certification";

// ─── My Certifications List Dialog ────────────────────

interface CertificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CertificationDialog({ open, onOpenChange }: CertificationDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { data: certifications, isLoading } = useMyCertifications();
  const { data: certRoles } = useCertificationRoles();
  const [addOpen, setAddOpen] = useState(false);
  const [editCert, setEditCert] = useState<Certification | null>(null);

  const statusLabel = (status: number) => {
    switch (status) {
      case AUTH_STATUS.PENDING:
        return <span className="text-yellow-400">{t("certPending")}</span>;
      case AUTH_STATUS.REJECTED:
        return <span className="text-red-400">{t("certRejected")}</span>;
      case AUTH_STATUS.APPROVED:
        return <span className="text-green-400">{t("certApproved")}</span>;
      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("myCertifications")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {isLoading ? (
              <div className="flex h-20 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (certifications ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("noCertifications")}
              </p>
            ) : (
              (certifications ?? []).map((cert) => (
                <button
                  key={cert.id}
                  type="button"
                  onClick={() => {
                    if (cert.authStatus === AUTH_STATUS.REJECTED) {
                      setEditCert(cert);
                      setAddOpen(true);
                    }
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="text-sm font-medium">
                    {certRoles?.[String(cert.authRoleId)] ?? t("unknownRole")}
                  </span>
                  {statusLabel(cert.authStatus)}
                </button>
              ))
            )}
          </div>

          <Button
            className="w-full"
            onClick={() => {
              setEditCert(null);
              setAddOpen(true);
            }}
          >
            <IconPlus className="size-4" />
            {t("addCertification")}
          </Button>
        </DialogContent>
      </Dialog>

      <CertificationFormDialog open={addOpen} onOpenChange={setAddOpen} editCert={editCert} />
    </>
  );
}

// ─── Certification Form Dialog ────────────────────────

function CertificationFormDialog({
  open,
  onOpenChange,
  editCert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editCert: Certification | null;
}) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { data: certRoles } = useCertificationRoles();
  const { mutate: doSubmit, isPending: submitting } = useSubmitCertification();
  const { mutate: doUpdate, isPending: updating } = useUpdateCertification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [roleId, setRoleId] = useState("");
  const [files, setFiles] = useState<Array<{ src: string; preview?: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const isPending = submitting || updating;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      toast.error(t("pleaseUploadImage"));
      return;
    }

    setUploading(true);
    try {
      const path = await api.upload<string>("/user/uploadAratar", file);
      setFiles((prev) => [...prev, { src: buildOssUrl(path), preview: URL.createObjectURL(file) }]);
    } catch {
      toast.error(t("coverUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!roleId) {
      toast.warning(t("selectRole"));
      return;
    }
    if (files.length === 0) {
      toast.warning(t("uploadProof"));
      return;
    }

    const payload = {
      roleId: Number(roleId),
      file: files.map((f) => ({ src: f.src })),
    };

    const onSuccess = () => {
      toast.success(t("certSubmitSuccess"));
      onOpenChange(false);
      setRoleId("");
      setFiles([]);
    };
    const onError = () => toast.error(t("certSubmitFailed"));

    if (editCert?.id) {
      doUpdate({ ...payload, id: editCert.id }, { onSuccess, onError });
    } else {
      doSubmit(payload, { onSuccess, onError });
    }
  };

  const roleOptions = Object.entries(certRoles ?? {}).map(([id, name]) => ({
    value: id,
    label: name,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("certInfo")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field>
            <FieldLabel>{t("certRole")}</FieldLabel>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger>
                <SelectValue placeholder={t("selectRole")} />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>{t("certProof")}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="group relative size-20 overflow-hidden rounded-lg border border-border bg-muted"
                >
                  <img
                    src={file.preview || file.src}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {uploading ? (
                  <IconLoader2 className="size-5 animate-spin" />
                ) : (
                  <IconPlus className="size-5" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
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
          <Button onClick={handleSubmit} disabled={isPending || uploading}>
            {isPending ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {tc("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
