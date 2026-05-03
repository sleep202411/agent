"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconPhotoPlus, IconUpload, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { backendApi } from "@/src/lib/api";
import { buildOssUrl, uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { useTranslations } from "@/src/i18n/i18n";
import { worldKeys } from "@/src/hooks/use-worlds";

/** Payload returned by `/api/user/world/create/quick/worldproduct`. */
type CreateQuickWorldResult = {
  worldId: string;
  projectId: string;
};

const MAX_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 500;

type FormErrors = {
  name?: string;
};

export function CreateWorldDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on success with the new (worldId, projectId). */
  onCreated?: (result: CreateQuickWorldResult) => void;
}) {
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setImagePath("");
    setUploading(false);
    setSubmitting(false);
    setErrors({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.warning(tc("selectImageFile"));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadWorkspaceFile(file, {
        uploadType: "WORLD",
        sourceType: "LOCAL",
      });
      setImagePath(uploaded.path);
    } catch (err) {
      console.error("[CreateWorldDialog] 上传封面失败:", err);
      toast.error(tw("createWorldCoverUploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const validate = (): boolean => {
    const next: FormErrors = {};
    const trimmedName = name.trim();
    if (!trimmedName) next.name = tw("createWorldNameRequired");
    else if (trimmedName.length > MAX_NAME_LENGTH) {
      next.name = tw("createWorldNameMaxLength", { max: MAX_NAME_LENGTH });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (submitting || uploading) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      // Mirrors the legacy `createQuickWorldProduct` call: Java's
      // `/quick/worldproduct` endpoint creates a world + its first
      // project in one shot. The legacy form only submitted name +
      // imagePath; we also send `description` so if / when the
      // backend picks it up it surfaces on the world record. The
      // response is `{ worldId, projectId }` — used to jump straight
      // into the new project detail.
      const result = await backendApi.post<CreateQuickWorldResult>(
        "/api/user/world/create/quick/worldproduct",
        {
          data: {
            name: name.trim(),
            imagePath: imagePath || undefined,
            description: description.trim() || undefined,
          },
        }
      );

      toast.success(tw("createWorldSuccess"));
      await queryClient.invalidateQueries({ queryKey: worldKeys.all });
      reset();
      onOpenChange(false);

      if (result?.projectId && result?.worldId) {
        router.push(`/projects/${result.projectId}?worldId=${result.worldId}`);
        onCreated?.(result);
      }
    } catch (err) {
      console.error("[CreateWorldDialog] 创建世界失败:", err);
      toast.error(err instanceof Error ? err.message : tw("createWorldFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const coverUrl = imagePath ? buildOssUrl(imagePath) : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[min(92vw,480px)]">
        <DialogHeader>
          <DialogTitle>{tw("createWorldDialogTitle")}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFileChange(event)}
          />

          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="create-world-name" required>
                {tw("createWorldNameLabel")}
              </FieldLabel>
              <Input
                id="create-world-name"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => {
                  setName(event.target.value);
                  if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder={tw("createWorldNamePlaceholder")}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            {/* Cover is optional — the 上传 trigger is a regular
                shadcn Button; the aspect-video area below is just a
                preview surface (not itself a button), with an inline
                Button for clearing the uploaded cover. */}
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>{tw("createWorldCoverLabel")}</FieldLabel>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  color="muted"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <IconLoader2 className="size-3 animate-spin" />
                  ) : (
                    <IconUpload className="size-3" />
                  )}
                  {uploading ? tw("createWorldCoverUploading") : tc("upload")}
                </Button>
              </div>
              <div className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                {coverUrl ? (
                  <>
                    <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                    {uploading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <IconLoader2 className="size-5 animate-spin text-white" />
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="soft"
                        color="destructive"
                        onClick={() => setImagePath("")}
                        aria-label={tc("delete")}
                        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <IconX className="size-3" />
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                    <IconPhotoPlus className="size-6" />
                    <span>{tw("createWorldCoverHint")}</span>
                  </div>
                )}
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="create-world-description">
                {tw("createWorldDescriptionLabel")}
              </FieldLabel>
              <Textarea
                id="create-world-description"
                value={description}
                maxLength={MAX_DESCRIPTION_LENGTH}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={tw("createWorldDescriptionPlaceholder")}
              />
            </Field>
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || uploading}
          >
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {tw("createWorldSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
