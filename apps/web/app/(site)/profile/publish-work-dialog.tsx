"use client";

import { useRef, useState } from "react";
import { IconLoader2, IconUpload, IconVideo, IconCheck, IconGitBranch } from "@tabler/icons-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreatePersonalWork,
  useUploadPersonalVideo,
  useUpdatePersonalWork,
} from "@/src/hooks/use-my-projects";
import type { PersonalWork } from "@/src/services/project";
import { env } from "@/src/env";

interface PublishWorkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass existing work to enter edit mode */
  editWork?: PersonalWork | null;
}

export function PublishWorkDialog({ open, onOpenChange, editWork }: PublishWorkDialogProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const router = useRouter();
  const isEdit = Boolean(editWork);

  // Step: 0 = info, 1 = upload
  const [step, setStep] = useState(0);
  const [personalId, setPersonalId] = useState<number | null>(null);

  // Step 1 form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Step 2 upload
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");

  const { mutateAsync: doCreate, isPending: creating } = useCreatePersonalWork();
  const { mutateAsync: doUpload, isPending: uploading } = useUploadPersonalVideo();
  const { mutateAsync: doUpdate, isPending: updating } = useUpdatePersonalWork();

  const resetForm = () => {
    setStep(0);
    setPersonalId(editWork?.id ?? null);
    setTitle(editWork?.title ?? "");
    setDescription(editWork?.introduction ?? "");
    setVideoFile(null);
    setVideoPreview("");
  };

  // Pre-fill when editWork changes
  const prevEditIdRef = useRef<number | null>(null);
  if (open && editWork && editWork.id !== prevEditIdRef.current) {
    prevEditIdRef.current = editWork.id;
    setPersonalId(editWork.id);
    setTitle(editWork.title ?? "");
    setDescription(editWork.introduction ?? "");
    setStep(1); // Skip to upload step for existing works
  }
  if (!open && prevEditIdRef.current !== null) {
    prevEditIdRef.current = null;
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  // Step 1: Create or Update record
  const handleSaveInfo = async () => {
    if (!title.trim()) {
      toast.warning(t("publishTitleRequired"));
      return;
    }

    try {
      if (isEdit && personalId) {
        await doUpdate({
          id: personalId,
          title: title.trim(),
          introduction: description.trim() || undefined,
        });
        setStep(1);
      } else {
        const result = await doCreate({
          title: title.trim(),
          introduction: description.trim() || undefined,
          viewStatus: 1,
        });
        const id = (result as unknown as { id?: number })?.id ?? (result as unknown as number);
        if (!id) throw new Error("No ID returned");
        setPersonalId(typeof id === "number" ? id : Number(id));
        setStep(1);
      }
    } catch {
      toast.error(isEdit ? t("publishUpdateFailed") : t("publishCreateFailed"));
    }
  };

  // Step 2: Upload video
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.type.startsWith("video/")) {
      toast.error(t("publishVideoTypeError"));
      return;
    }
    if (file.size > 5120 * 1024 * 1024) {
      toast.error(t("publishVideoSizeError"));
      return;
    }

    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!videoFile || !personalId) return;

    try {
      await doUpload({ id: personalId, file: videoFile });
      toast.success(t("publishSuccess"));
      handleClose(false);
    } catch {
      toast.error(t("publishUploadFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 0
              ? isEdit
                ? t("publishEditWork")
                : t("publishWork")
              : t("publishUploadVideo")}
          </DialogTitle>
        </DialogHeader>

        {step === 0 ? (
          <>
            <DialogBody>
              <Field>
                <FieldLabel>{t("publishTitle")}</FieldLabel>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("publishTitlePlaceholder")}
                  maxLength={50}
                />
              </Field>
              <Field>
                <FieldLabel>{t("publishDescription")}</FieldLabel>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("publishDescriptionPlaceholder")}
                  maxLength={500}
                  rows={4}
                />
                <div className="text-right text-[11px] text-muted-foreground">
                  {description.length}/500
                </div>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" color="muted" onClick={() => handleClose(false)}>
                {tc("cancel")}
              </Button>
              <Button onClick={handleSaveInfo} disabled={creating || updating}>
                {(creating || updating) && <IconLoader2 className="size-3.5 animate-spin" />}
                {t("publishNext")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody>
              <div className="grid grid-cols-2 gap-3">
                {/* Upload video option */}
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className={`flex flex-col items-center gap-3 rounded-xl border-2 p-6 text-center transition-colors ${
                    videoFile
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <IconUpload className="size-8 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{t("publishUploadOption")}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("publishUploadOptionDesc")}
                    </div>
                  </div>
                </button>

                {/* Interactive video option */}
                <button
                  type="button"
                  onClick={() => {
                    if (!personalId) return;
                    handleClose(false);
                    router.push(`/profile/interactive/${personalId}`);
                  }}
                  className="flex flex-col items-center gap-3 rounded-xl border-2 border-border p-6 text-center transition-colors hover:border-primary/50"
                >
                  <IconGitBranch className="size-8 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{t("publishInteractiveOption")}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("publishInteractiveOptionDesc")}
                    </div>
                  </div>
                </button>
              </div>

              {/* Video preview (shown after selecting file) */}
              {videoFile && (
                <div className="space-y-3">
                  <div className="relative overflow-hidden rounded-lg bg-black">
                    <video
                      src={videoPreview}
                      className="aspect-video w-full object-contain"
                      controls
                    />
                    <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 text-[10px] font-medium text-white">
                      <IconCheck className="size-3" />
                      {t("publishVideoReady")}
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      color="muted"
                      size="sm"
                      onClick={() => videoInputRef.current?.click()}
                    >
                      {t("publishChangeVideo")}
                    </Button>
                  </div>
                </div>
              )}

              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleVideoSelect}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" color="muted" onClick={() => setStep(0)}>
                {t("publishBack")}
              </Button>
              <Button onClick={handleUpload} disabled={!videoFile || uploading}>
                {uploading && <IconLoader2 className="size-3.5 animate-spin" />}
                {t("publishUpload")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
