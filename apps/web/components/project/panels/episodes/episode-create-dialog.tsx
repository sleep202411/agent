"use client";

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { backendApi } from "@/src/lib/api";
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
    resolver: zodResolver(schema),
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

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("episodeName")} *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={50}
                      placeholder={t("episodeNamePlaceholder")}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="introduction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("introduction")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={500}
                      rows={2}
                      placeholder={t("introductionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="frontPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("frontPrompt")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={1000}
                      rows={2}
                      placeholder={t("frontPromptPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="behindPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("behindPrompt")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={1000}
                      rows={2}
                      placeholder={t("behindPromptPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
        </Form>
      </DialogContent>
    </Dialog>
  );
}
