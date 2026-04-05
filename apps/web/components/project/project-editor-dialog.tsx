"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { IconLoader2, IconUpload, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { backendApi } from "@/src/lib/api";
import { fetchProjectDictionaries } from "@/src/lib/project-dictionaries";
import type { ProjectDictionaries, ProjectOptionItem } from "@/src/types/workspace";
import { buildOssUrl, uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";

function ossUrl(path?: string) {
  return buildOssUrl(path);
}

interface ProjectEditorDialogProps {
  open: boolean;
  worldId: string;
  project?: ProjectOptionItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (project?: ProjectOptionItem | null) => void;
}

type FormState = {
  name: string;
  description: string;
  type: string;
  episode: string;
  chapterLength: string;
  stylePainting: string;
  aspectRatioType: string;
  imagePath: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  type: "",
  episode: "",
  chapterLength: "",
  stylePainting: "",
  aspectRatioType: "",
  imagePath: "",
};

type FormErrors = Partial<Record<keyof Omit<FormState, "imagePath">, string>>;

function validateForm(form: FormState, t: (key: string) => string): FormErrors {
  const errors: FormErrors = {};
  if (!form.type) errors.type = t("validateType");
  if (!form.name.trim()) errors.name = t("validateName");
  if (!form.description.trim()) errors.description = t("validateDescription");
  if (!form.episode || Number(form.episode) <= 0) errors.episode = t("validateEpisode");
  if (!form.chapterLength || Number(form.chapterLength) <= 0)
    errors.chapterLength = t("validateDuration");
  if (!form.aspectRatioType) errors.aspectRatioType = t("validateSize");
  if (!form.stylePainting) errors.stylePainting = t("validateStyle");
  return errors;
}

export function ProjectEditorDialog({
  open,
  worldId,
  project,
  onOpenChange,
  onSaved,
}: ProjectEditorDialogProps) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dictionaries, setDictionaries] = useState<ProjectDictionaries | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetchProjectDictionaries()
      .then((data) => {
        if (active) setDictionaries(data);
      })
      .catch((error) => {
        console.error("[ProjectEditorDialog] 加载项目字典失败:", error);
        toast.error(t("loadConfigFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (!project) {
      setForm(emptyForm);
      return;
    }
    setForm({
      name: String(project.name ?? ""),
      description: String(project.description ?? ""),
      type: project.type != null ? String(project.type) : "",
      episode: project.episode != null ? String(project.episode) : "",
      chapterLength: project.chapterLength != null ? String(project.chapterLength) : "",
      stylePainting: project.stylePainting != null ? String(project.stylePainting) : "",
      aspectRatioType: project.aspectRatioType != null ? String(project.aspectRatioType) : "",
      imagePath: String(project.imagePath ?? ""),
    });
  }, [open, project]);

  const selectedStyle = useMemo(
    () => dictionaries?.styleOptions.find((item) => item.id === form.stylePainting),
    [dictionaries?.styleOptions, form.stylePainting]
  );

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as keyof FormErrors]) return prev;
      return { ...prev, [key]: undefined };
    });
  };

  const handleTextChange =
    (key: keyof Pick<FormState, "name" | "description">) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setField(key, event.target.value);

  const handleNumberChange =
    (key: keyof Pick<FormState, "episode" | "chapterLength">) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setField(key, event.target.value.replace(/[^\d]/g, ""));

  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadWorkspaceFile(file, {
        uploadType: "WORLD",
        sourceType: "LOCAL",
      });
      setField("imagePath", uploaded.path);
      toast.success(t("coverUploadSuccess"));
    } catch (error) {
      console.error("[ProjectEditorDialog] 上传失败:", error);
      toast.error(error instanceof Error ? error.message : t("coverUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!worldId) return;
    const nextErrors = validateForm(form, t);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    const payload = {
      ...(project?.id ? { id: project.id } : {}),
      worldId,
      name: form.name.trim(),
      description: form.description.trim(),
      type: form.type ? Number(form.type) : undefined,
      episode: form.episode ? Number(form.episode) : undefined,
      chapterLength: form.chapterLength ? Number(form.chapterLength) : undefined,
      stylePainting: form.stylePainting || undefined,
      aspectRatioType: form.aspectRatioType || undefined,
      imagePath: form.imagePath || undefined,
    };

    try {
      const saved = project?.id
        ? await backendApi.post<ProjectOptionItem>("/api/user/world/update/worldproduct", {
            data: payload,
          })
        : await backendApi.post<ProjectOptionItem>("/api/user/world/create/worldproduct", {
            data: payload,
          });
      toast.success(project?.id ? t("projectUpdateSuccess") : t("projectCreateSuccess"));
      onSaved(payload as ProjectOptionItem);
      onOpenChange(false);
    } catch (error) {
      console.error("[ProjectEditorDialog] 保存失败:", error);
      toast.error(project?.id ? t("projectUpdateFailed") : t("projectCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[600px]">
        <DialogHeader className="px-6 py-5">
          <DialogTitle>{project?.id ? t("editProject") : t("newProject")}</DialogTitle>
          <p className="sr-only">{t("editProjectInfo")}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form id="project-editor-form" onSubmit={handleSave}>
            <div className="max-h-[60vh] overflow-y-auto px-6 pb-4">
              <FieldGroup>
                {/* Type + Name */}
                <div className="flex gap-4">
                  <Field className="flex-1">
                    <FieldLabel>{t("projectType")}</FieldLabel>
                    <Select value={form.type} onValueChange={(v) => setField("type", v)}>
                      <SelectTrigger aria-invalid={Boolean(errors.type)}>
                        <SelectValue placeholder={t("projectTypePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {dictionaries?.typeOptions.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError>{errors.type}</FieldError>
                  </Field>

                  <Field className="flex-1">
                    <FieldLabel>{t("projectName")}</FieldLabel>
                    <Input
                      value={form.name}
                      maxLength={20}
                      onChange={handleTextChange("name")}
                      placeholder={t("projectNamePlaceholder")}
                      aria-invalid={Boolean(errors.name)}
                    />
                    <div className="text-right text-[11px] text-muted-foreground">
                      {form.name.length}/20
                    </div>
                    <FieldError>{errors.name}</FieldError>
                  </Field>
                </div>

                {/* Description */}
                <Field>
                  <FieldLabel>{t("projectDescription")}</FieldLabel>
                  <Textarea
                    value={form.description}
                    rows={3}
                    maxLength={300}
                    onChange={handleTextChange("description")}
                    placeholder={t("projectDescriptionPlaceholder")}
                    className="resize-none"
                    aria-invalid={Boolean(errors.description)}
                  />
                  <div className="text-right text-[11px] text-muted-foreground">
                    {form.description.length}/300
                  </div>
                  <FieldError>{errors.description}</FieldError>
                </Field>

                {/* Cover */}
                <Field>
                  <FieldLabel>{t("uploadCover")}</FieldLabel>
                  <div className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="group flex size-20 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border transition-colors hover:border-primary/50 disabled:opacity-70"
                    >
                      {form.imagePath ? (
                        <img
                          src={ossUrl(form.imagePath)}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : uploading ? (
                        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      ) : (
                        <IconUpload className="size-5 text-muted-foreground" />
                      )}
                    </button>
                    {form.imagePath && (
                      <button
                        type="button"
                        onClick={() => setField("imagePath", "")}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <IconX className="size-3" />
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => {
                      handleUpload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </Field>

                {/* Episodes + Duration */}
                <div className="flex gap-4">
                  <Field className="flex-1">
                    <FieldLabel>{t("episodeCount")}</FieldLabel>
                    <Input
                      value={form.episode}
                      inputMode="numeric"
                      maxLength={4}
                      onChange={handleNumberChange("episode")}
                      placeholder={t("episodeCountPlaceholder")}
                      aria-invalid={Boolean(errors.episode)}
                    />
                    <FieldError>{errors.episode}</FieldError>
                  </Field>
                  <Field className="flex-1">
                    <FieldLabel>{t("episodeDuration")}</FieldLabel>
                    <Input
                      value={form.chapterLength}
                      inputMode="numeric"
                      maxLength={4}
                      onChange={handleNumberChange("chapterLength")}
                      placeholder={t("episodeDurationPlaceholder")}
                      aria-invalid={Boolean(errors.chapterLength)}
                    />
                    <FieldError>{errors.chapterLength}</FieldError>
                  </Field>
                </div>

                {/* Video Size */}
                <Field>
                  <FieldLabel>{t("videoSize")}</FieldLabel>
                  <Select
                    value={form.aspectRatioType}
                    onValueChange={(v) => setField("aspectRatioType", v)}
                  >
                    <SelectTrigger aria-invalid={Boolean(errors.aspectRatioType)}>
                      <SelectValue placeholder={t("videoSizePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {dictionaries?.sizeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError>{errors.aspectRatioType}</FieldError>
                </Field>

                {/* Art Style */}
                <Field>
                  <FieldLabel>{t("artStyle")}</FieldLabel>
                  <div
                    className={cn(
                      "mb-2 text-sm",
                      selectedStyle?.info ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {selectedStyle?.info ?? t("artStylePlaceholder")}
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {dictionaries?.styleOptions.map((style) => {
                      const active = style.id === form.stylePainting;
                      return (
                        <button
                          key={style.id}
                          type="button"
                          onClick={() => setField("stylePainting", String(style.id))}
                          className={cn(
                            "overflow-hidden rounded-lg border-2 text-left transition-all",
                            active ? "border-primary" : "border-transparent hover:border-primary/50"
                          )}
                        >
                          <div className="relative aspect-square bg-muted">
                            {style.picLink && (
                              <img
                                src={ossUrl(style.picLink)}
                                alt={style.info ?? ""}
                                className="size-full object-cover"
                              />
                            )}
                            {active && (
                              <div className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                                ✓
                              </div>
                            )}
                          </div>
                          <span className="block px-1 py-1.5 text-center text-[11px] text-muted-foreground">
                            {style.info ?? t("unnamedStyle")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <FieldError>{errors.stylePainting}</FieldError>
                </Field>
              </FieldGroup>
            </div>

            <DialogFooter className="border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={() => onOpenChange(false)}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={saving || loading || uploading}>
                {saving && <IconLoader2 className="size-3.5 animate-spin" />}
                {tc("confirm")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
