"use client";

import { useEffect, useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { backendApi } from "@/src/lib/api";
import type { RawAiModel } from "@/src/types/workspace";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";

const MUSIC_SHOT_ID = -100;
const MUSIC_COLUMN_ID = -100;

interface MusicCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function MusicCreateDialog({ open, onOpenChange, onCreated }: MusicCreateDialogProps) {
  const t = useTranslations("music");
  const tc = useTranslations("common");

  const { models: cachedModels } = useRawAiModels(AI_MODEL_PATHS.music);
  const models = cachedModels as RawAiModel[];

  const [isGenerating, setIsGenerating] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    prompt: "",
    tags: "",
    model: "",
  });

  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: item.serviceName ?? item.serviceCode ?? "",
        value: String(item.serviceCode ?? ""),
      })),
    [models]
  );

  useEffect(() => {
    if (models.length === 0) return;
    setFormData((prev) => ({
      ...prev,
      model:
        prev.model ||
        String(models.find((m) => m.isDefault)?.serviceCode ?? models[0]?.serviceCode ?? ""),
    }));
  }, [models]);

  // Only reset form after successful generation, not on open/close
  const resetForm = () => {
    setFormData((prev) => ({ title: "", prompt: "", tags: "", model: prev.model }));
  };

  const handleGenerate = async () => {
    if (!formData.title.trim()) {
      toast.warning(t("musicTitleRequired"));
      return;
    }

    setIsGenerating(true);
    try {
      await backendApi.post("/api/ai/voice/music", {
        data: {
          shotId: MUSIC_SHOT_ID,
          shotColumnId: MUSIC_COLUMN_ID,
          model: formData.model || undefined,
          // Backend rejects an empty prompt but happily accepts any
          // punctuation — backend dev confirmed 2026-05-24. Auto-fill
          // so users who don't care about lyrics aren't blocked.
          prompt: formData.prompt.trim() || "...",
          title: formData.title.trim(),
          tags: formData.tags.trim(),
        },
        timeout: 360_000,
      });
      toast.success(t("generateSuccess"));
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (error) {
      console.error("[MusicCreateDialog] generate failed:", error);
      toast.error(t("generateFailed"));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>{t("aiGenerateMusic")}</DialogTitle>
        </DialogHeader>

        <div className="p-4">
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("musicTitle")}</FieldLabel>
              <Input
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={t("musicTitlePlaceholder")}
              />
            </Field>

            <Field>
              <FieldLabel>{t("musicLyrics")}</FieldLabel>
              <Textarea
                value={formData.prompt}
                onChange={(e) => setFormData((prev) => ({ ...prev, prompt: e.target.value }))}
                placeholder={t("musicLyricsPlaceholder")}
                rows={4}
              />
            </Field>

            <Field>
              <FieldLabel>{t("tags")}</FieldLabel>
              <Input
                value={formData.tags}
                onChange={(e) => setFormData((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder={t("tagsPlaceholder")}
              />
            </Field>

            <Field>
              <FieldLabel>{t("model")}</FieldLabel>
              <Select
                value={formData.model}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, model: value }))}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      modelOptions.length > 0 ? t("modelPlaceholder") : t("loadingModel")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => void handleGenerate()} disabled={isGenerating}>
            {isGenerating && <IconLoader2 className="size-4 animate-spin" />}
            {isGenerating ? tc("generating") : tc("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
