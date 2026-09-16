import { useCurrentUser } from "@/src/hooks/use-user";
import { useLayoutEffect, useRef, useState } from "react";
import { IconCertificate, IconLoader2, IconPlus, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
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
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
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

export function CertificationDialog(props: CertificationDialogProps) {
  const { user } = useCurrentUser();
  return <CertificationDialogContent key={user?.id ?? "guest"} {...props} />;
}
function CertificationDialogContent({ open, onOpenChange }: CertificationDialogProps) {
  const t = useTranslations("profile");
  const { data: certifications, isLoading } = useMyCertifications();
  const { data: certRoles } = useCertificationRoles();
  const [addOpen, setAddOpen] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setAddOpen(false);
  }
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

          <div className="py-2">
            {isLoading ? (
              <div className="flex h-20 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (certifications ?? []).length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconCertificate />
                  </EmptyMedia>
                  <EmptyTitle>{t("noCertifications")}</EmptyTitle>
                  <EmptyDescription>{t("noCertificationsDesc")}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    onClick={() => {
                      setEditCert(null);
                      setFormRevision((revision) => revision + 1);
                      setAddOpen(true);
                    }}
                  >
                    <IconPlus className="size-4" />
                    {t("addCertification")}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="space-y-3">
                {(certifications ?? []).map((cert) => (
                  <button
                    key={cert.id}
                    type="button"
                    onClick={() => {
                      if (cert.authStatus === AUTH_STATUS.REJECTED) {
                        setEditCert(cert);
                        setFormRevision((revision) => revision + 1);
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
                ))}
                <Button
                  className="w-full"
                  onClick={() => {
                    setEditCert(null);
                    setFormRevision((revision) => revision + 1);
                    setAddOpen(true);
                  }}
                >
                  <IconPlus className="size-4" />
                  {t("addCertification")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CertificationFormDialog
        key={JSON.stringify([editCert?.id ?? "new", formRevision])}
        open={open && addOpen}
        onOpenChange={setAddOpen}
        editCert={editCert}
      />
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
  const { mutateAsync: doSubmit, isPending: submitting } = useSubmitCertification();
  const { mutateAsync: doUpdate, isPending: updating } = useUpdateCertification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [roleId, setRoleId] = useState(editCert ? String(editCert.authRoleId) : "");
  const [files, setFiles] = useState<Array<{ src: string; preview?: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const [saving, setSaving] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const active = useRef(false);
  const previews = useRef(new Set<string>());
  useLayoutEffect(() => {
    active.current = open;
    const owned = previews.current;
    return () => {
      active.current = false;
      operation.current?.abort();
      operation.current = null;
      for (const url of owned) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, [open]);
  const isPending = saving || submitting || updating;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!active.current || operation.current) return;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      toast.error(t("pleaseUploadImage"));
      return;
    }

    const request = new AbortController();
    operation.current = request;
    setUploading(true);
    try {
      const path = await api.upload<string>("/user/uploadAratar", file, "file", {
        signal: request.signal,
      });
      if (request.signal.aborted || !active.current) return;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      setFiles((prev) => [...prev, { src: buildOssUrl(path), preview }]);
    } catch {
      if (!request.signal.aborted && active.current) toast.error(t("coverUploadFailed"));
    } finally {
      if (operation.current === request) {
        operation.current = null;
        if (active.current) setUploading(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (!active.current || operation.current) return;
    if (!roleId || !certRoles || !Object.hasOwn(certRoles, roleId)) {
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

    const request = new AbortController();
    operation.current = request;
    setSaving(true);
    try {
      if (editCert?.id) await doUpdate({ ...payload, id: editCert.id });
      else await doSubmit(payload);
      if (!active.current || request.signal.aborted) return;
      toast.success(t("certSubmitSuccess"));
      onOpenChange(false);
    } catch {
      if (active.current && !request.signal.aborted) toast.error(t("certSubmitFailed"));
    } finally {
      if (operation.current === request) {
        operation.current = null;
        if (active.current) setSaving(false);
      }
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

        <DialogBody>
          <Field>
            <FieldLabel>{t("certRole")}</FieldLabel>
            <Select value={roleId} onValueChange={setRoleId} disabled={isPending || uploading}>
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
                    disabled={isPending || uploading}
                    onClick={() => {
                      if (file.preview) {
                        URL.revokeObjectURL(file.preview);
                        previews.current.delete(file.preview);
                      }
                      setFiles((prev) => prev.filter((_, i) => i !== index));
                    }}
                    className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isPending}
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
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tc("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || uploading || !certRoles || !Object.hasOwn(certRoles, roleId)}
          >
            {isPending ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {tc("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
