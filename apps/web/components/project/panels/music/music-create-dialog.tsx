"use client";

import { useEffect, useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { backendApi } from "@/src/lib/api";
import type { RawAiModel } from "@/src/types/workspace";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";

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

  useEffect(() => {
    if (open) {
      setFormData((prev) => ({ title: "", prompt: "", tags: "", model: prev.model }));
    }
  }, [open]);

  const handleGenerate = async () => {
    if (!formData.prompt.trim()) {
      toast.warning(t("musicDescriptionPlaceholder"));
      return;
    }

    setIsGenerating(true);
    try {
      await backendApi.post("/api/ai/voice/music", {
        data: {
          shotId: MUSIC_SHOT_ID,
          shotColumnId: MUSIC_COLUMN_ID,
          model: formData.model || undefined,
          prompt: formData.prompt.trim(),
          title: formData.title.trim(),
          tags: formData.tags.trim(),
        },
        timeout: 360_000,
      });
      toast.success(t("generateSuccess"));
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
    <Dialog open={open} onOpenChange={(v) => (!isGenerating ? onOpenChange(v) : undefined)}>
      <DialogContent showCloseButton={!isGenerating} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("aiGenerateMusic")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("musicTitle")}</div>
            <Input
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder={t("musicTitlePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t("musicDescription")}</div>
            <Textarea
              value={formData.prompt}
              onChange={(e) => setFormData((prev) => ({ ...prev, prompt: e.target.value }))}
              placeholder={t("musicDescriptionPlaceholder")}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t("tags")}</div>
            <Input
              value={formData.tags}
              onChange={(e) => setFormData((prev) => ({ ...prev, tags: e.target.value }))}
              placeholder={t("tagsPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t("model")}</div>
            <NativeSelect
              value={formData.model}
              onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
            >
              <NativeSelectOption value="" disabled>
                {modelOptions.length > 0 ? t("modelPlaceholder") : t("loadingModel")}
              </NativeSelectOption>
              {modelOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={isGenerating}
          >
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
