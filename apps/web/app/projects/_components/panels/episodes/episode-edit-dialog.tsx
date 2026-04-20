"use client";

import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { store } from "@/src/store";
import { updateEpisodeInStore, type Episode } from "@/src/store/slices/projectSlice";

function useEpisodeSchema() {
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

interface EpisodeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episode: Episode;
  onSaved: () => void;
}

export function EpisodeEditDialog({
  open,
  onOpenChange,
  episode,
  onSaved,
}: EpisodeEditDialogProps) {
  const t = useTranslations("episode");
  const tc = useTranslations("common");

  const schema = useEpisodeSchema();
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      introduction: "",
      frontPrompt: "",
      behindPrompt: "",
    },
  });

  useEffect(() => {
    if (!open || !episode) return;
    form.reset({
      title: String(episode.title ?? ""),
      introduction: String(episode.introduction ?? ""),
      frontPrompt: String(episode.frontPrompt ?? ""),
      behindPrompt: String(episode.behindPrompt ?? ""),
    });
  }, [open, episode, form]);

  const onSubmit = async (values: FormValues) => {
    const episodeId = String(episode.id ?? "");
    if (!episodeId) return;
    try {
      const projectId = store.getState().project.currentProjectId;
      // Full payload: merge original episode fields with edited values
      await backendApi.post("/api/user/world/update/episode", {
        data: {
          id: episodeId,
          projectId,
          title: values.title,
          introduction: values.introduction,
          frontPrompt: values.frontPrompt,
          behindPrompt: values.behindPrompt,
          sort: episode.sort ?? 0,
          videoLength: episode.videoLength ?? 0,
        },
      });
      store.dispatch(updateEpisodeInStore({ id: episodeId, data: values }));
      toast.success(t("episodeUpdated"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("[EpisodeEditDialog] 保存失败:", err);
      toast.error(tc("saveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editEpisode")}</DialogTitle>
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
                    rows={3}
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
                    rows={3}
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
                    rows={3}
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
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
