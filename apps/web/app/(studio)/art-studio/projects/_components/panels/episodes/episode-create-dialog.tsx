"use client";

import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { backendApi } from "@/src/lib/api";
import { typedZodResolver } from "@/src/lib/forms/typed-zod-resolver";
import { useAppSelector } from "@/src/store";

function useEpisodeCreateSchema() {
  const t = useTranslations("episode");
  return useMemo(
    () =>
      z.object({
        title: z.string().min(1, t("titleRequired")).max(50, t("titleMaxLength")),
        introduction: z.string().max(500),
        frontPrompt: z.string().max(1000),
        behindPrompt: z.string().max(1000),
      }),
    [t]
  );
}

interface EpisodeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (episodeId: string, title?: string) => void;
}

export function EpisodeCreateDialog({ open, onOpenChange, onCreated }: EpisodeCreateDialogProps) {
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const projectId = useAppSelector((s) => s.project.currentProjectId);

  const schema = useEpisodeCreateSchema();
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: typedZodResolver<FormValues>(schema),
    defaultValues: {
      title: "",
      introduction: "",
      frontPrompt: "",
      behindPrompt: "",
    },
  });

  useEffect(() => {
    if (open) form.reset();
  }, [open, form]);

  const onSubmit = async (values: FormValues) => {
    if (!projectId) return;
    try {
      const createdId = await backendApi.post<string | number>("/api/user/storyBoard/create", {
        data: { projectId, name: values.title, introduction: values.introduction || undefined },
      });
      toast.success(t("episodeCreated"));
      onOpenChange(false);
      if (createdId) {
        onCreated(String(createdId), values.title);
      }
    } catch (err) {
      console.error("[EpisodeCreateDialog] 创建失败:", err);
      toast.error(t("createFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("addEpisode")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup className="p-4">
            <Controller
              name="title"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} required>
                    {t("episodeName")}
                  </FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                    maxLength={50}
                    placeholder={t("episodeNamePlaceholder")}
                    autoFocus
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="introduction"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{t("introduction")}</FieldLabel>
                  <Textarea
                    {...field}
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                    maxLength={500}
                    rows={2}
                    placeholder={t("introductionPlaceholder")}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="frontPrompt"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{t("frontPrompt")}</FieldLabel>
                  <Textarea
                    {...field}
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                    maxLength={1000}
                    rows={2}
                    placeholder={t("frontPromptPlaceholder")}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="behindPrompt"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{t("behindPrompt")}</FieldLabel>
                  <Textarea
                    {...field}
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                    maxLength={1000}
                    rows={2}
                    placeholder={t("behindPromptPlaceholder")}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => onOpenChange(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <IconLoader2 className="size-3.5 animate-spin" />}
              {tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
