"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { IconCamera, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { backendApi } from "@/src/lib/api";
import { uploadWorkspaceFile, buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { PanelLayout } from "./panel-layout";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { setWorldDetail, selectCurrentInstance } from "@/src/store/slices/projectSlice";

function useWorldSchema() {
  const t = useTranslations("world");
  return z.object({
    name: z
      .string()
      .min(1, t("worldNameRequired"))
      .max(50, t("worldNameMaxLength", { max: 50 })),
    description: z.string().max(500),
    core: z
      .string()
      .min(1, t("storyCoreRequired"))
      .max(300, t("storyCoreMaxLength", { max: 300 })),
    devAdvise: z.string().max(300),
    bannerPath: z.string(),
  });
}

type WorldFormValues = z.infer<ReturnType<typeof useWorldSchema>>;

export function EditWorldPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("world");
  const tc = useTranslations("common");
  const worldSchema = useWorldSchema();
  const worldDetail = useAppSelector((s) => selectCurrentInstance(s).worldDetail);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isWorldLoading);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<WorldFormValues>({
    resolver: zodResolver(worldSchema),
    defaultValues: {
      name: "",
      description: "",
      core: "",
      devAdvise: "",
      bannerPath: "",
    },
  });

  useEffect(() => {
    if (!worldDetail) return;
    form.reset({
      name: String(worldDetail.name ?? ""),
      description: String(worldDetail.description ?? ""),
      core: String(worldDetail.core ?? ""),
      devAdvise: String(worldDetail.devAdvise ?? ""),
      bannerPath: String(worldDetail.bannerLink ?? worldDetail.filePath ?? ""),
    });
  }, [worldDetail, form]);

  const handleBannerUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const result = await uploadWorkspaceFile(file, {
          uploadType: "WORLD",
          accept: "image/*",
        });
        form.setValue("bannerPath", result.path);
        toast.success(tc("coverUpdated"));
      } catch (err) {
        console.error("[EditWorldPanel] 上传封面失败:", err);
        toast.error(err instanceof Error ? err.message : tc("uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [form]
  );

  const onSubmit = async (values: WorldFormValues) => {
    if (!worldDetail?.id) return;
    try {
      await backendApi.post("/api/user/world/update/world", {
        data: {
          id: worldDetail.id,
          name: values.name,
          description: values.description,
          core: values.core,
          devAdvise: values.devAdvise,
          bannerLink: values.bannerPath,
          filePath: values.bannerPath,
        },
      });
      store.dispatch(
        setWorldDetail({
          ...worldDetail,
          name: values.name,
          description: values.description,
          core: values.core,
          devAdvise: values.devAdvise,
          bannerLink: values.bannerPath,
          filePath: values.bannerPath,
        })
      );
      toast.success(tc("saveSuccess"));
    } catch (err) {
      console.error("[EditWorldPanel] 保存失败:", err);
      toast.error(tc("saveFailed"));
    }
  };

  const bannerPath = form.watch("bannerPath");
  const bannerSrc = buildOssUrl(bannerPath);

  return (
    <PanelLayout
      title={t("title")}
      onClose={onClose}
      loading={isLoading || !worldDetail}
      footer={
        <Button
          className="w-full"
          size="lg"
          onClick={form.handleSubmit(onSubmit)}
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting && <IconLoader2 className="size-3.5 animate-spin" />}
          {tc("save")}
        </Button>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleBannerUpload(file);
          e.currentTarget.value = "";
        }}
      />

      <button
        type="button"
        className="group relative w-full overflow-hidden rounded-xl"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {bannerSrc ? (
          <img src={bannerSrc} alt="" className="h-32 w-full object-cover" />
        ) : (
          <div className="flex h-32 w-full items-center justify-center bg-muted/30">
            <span className="text-xs text-muted-foreground">{t("clickUploadCover")}</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          {uploading ? (
            <IconLoader2 className="size-5 animate-spin text-white" />
          ) : (
            <IconCamera className="size-5 text-white" />
          )}
        </div>
      </button>

      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name} required>
                {t("worldName")}
              </FieldLabel>
              <Input
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
                maxLength={50}
                placeholder={t("worldNamePlaceholder")}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="description"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{t("storySynopsis")}</FieldLabel>
              <Textarea
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
                maxLength={500}
                rows={4}
                placeholder={t("storySynopsisPlaceholder")}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="core"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name} required>
                {t("storyCore")}
              </FieldLabel>
              <Textarea
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
                maxLength={300}
                rows={3}
                placeholder={t("storyCorePlaceholder")}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="devAdvise"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{t("devAdvice")}</FieldLabel>
              <Textarea
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
                maxLength={300}
                rows={3}
                placeholder={t("devAdvicePlaceholder")}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>
    </PanelLayout>
  );
}
