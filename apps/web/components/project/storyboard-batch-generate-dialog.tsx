"use client";

import { useEffect, useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useTranslations } from "next-intl";
import type { RawAiModel } from "@/src/types/workspace";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field";

export interface BatchGenerateConfig {
  model: string;
  size: string;
  regenerateFinalized: boolean;
  videoSize?: string;
  videoLength?: number;
}

interface StoryboardBatchGenerateDialogProps {
  open: boolean;
  columnType: "image" | "video";
  projectSize?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (config: BatchGenerateConfig) => void;
}

function parseImageSizes(model?: RawAiModel) {
  if (!model?.description) return [];
  try {
    const parsed = JSON.parse(model.description);
    let sizes = parsed?.size;
    if (typeof sizes === "string") {
      try {
        sizes = JSON.parse(sizes);
      } catch {
        sizes = [sizes];
      }
    }
    if (!Array.isArray(sizes)) return [];
    return sizes
      .map((item: unknown) => {
        if (typeof item === "string") {
          return { label: item, value: item, ratio: "" };
        }
        if (typeof item === "object" && item) {
          const ratio = String((item as { ratio?: string }).ratio ?? "");
          const dimension = String((item as { dimension?: string }).dimension ?? "");
          return {
            label: ratio && dimension ? `${ratio} (${dimension})` : dimension || ratio,
            value: dimension || ratio,
            ratio,
          };
        }
        return null;
      })
      .filter((item): item is { label: string; value: string; ratio: string } =>
        Boolean(item?.value)
      );
  } catch {
    return [];
  }
}

function parseVideoDescription(model?: RawAiModel) {
  if (!model?.description) return { sizes: [] as string[], videoLengths: [] as number[] };
  try {
    const parsed = JSON.parse(model.description);
    const sizes = Array.isArray(parsed?.size)
      ? parsed.size.map((item: unknown) => String(item)).filter(Boolean)
      : [];
    const videoLengths = Array.isArray(parsed?.videoLength)
      ? parsed.videoLength
          .map((item: unknown) => Number(item))
          .filter((item: number) => Number.isFinite(item) && item > 0)
      : [];
    return { sizes, videoLengths };
  } catch {
    return { sizes: [], videoLengths: [] };
  }
}

function normalizeProjectSize(value?: string) {
  return String(value ?? "")
    .replace(/^_+/, "")
    .replace(/_/g, ":")
    .trim();
}

function normalizeDimension(value?: string) {
  return String(value ?? "")
    .replace(/×/g, "x")
    .toLowerCase()
    .trim();
}

function normalizeRatio(value?: string) {
  return String(value ?? "")
    .replace(/^_+/, "")
    .replace(/_/g, ":")
    .replace(/\s+/g, "")
    .trim();
}

function gcd(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function ratioFromDimension(value?: string) {
  const normalized = normalizeDimension(value);
  const match = normalized.match(/(\d+)\s*x\s*(\d+)/);
  if (!match) return "";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "";
  const divider = gcd(width, height);
  return `${width / divider}:${height / divider}`;
}

function getPreferredImageSize(
  sizeOptions: Array<{ label: string; value: string; ratio: string }>,
  projectSize?: string
) {
  if (!sizeOptions.length) return "";
  const rawProjectSize = normalizeProjectSize(projectSize);
  const dimensionKey = normalizeDimension(rawProjectSize);
  const ratioKey = rawProjectSize.includes(":")
    ? normalizeRatio(rawProjectSize)
    : normalizeRatio(ratioFromDimension(rawProjectSize));

  const preferred =
    sizeOptions.find((item) => {
      const itemDimension = normalizeDimension(item.value);
      const itemRatio = normalizeRatio(item.ratio || ratioFromDimension(item.value) || item.value);
      if (dimensionKey && itemDimension === dimensionKey) return true;
      if (ratioKey && itemRatio === ratioKey) return true;
      return false;
    }) ?? sizeOptions[0];

  return preferred?.value ?? "";
}

function getDefaultVideoSettings(model?: RawAiModel) {
  const description = parseVideoDescription(model);
  return {
    videoSize: description.sizes[0] ?? "",
    videoLength: description.videoLengths[0] ? String(description.videoLengths[0]) : "",
  };
}

export function StoryboardBatchGenerateDialog({
  open,
  columnType,
  projectSize,
  loading = false,
  onOpenChange,
  onConfirm,
}: StoryboardBatchGenerateDialogProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const isVideo = columnType === "video";
  const { models: cachedImageModels, loading: imageModelsLoading } = useRawAiModels(
    AI_MODEL_PATHS.image
  );
  const { models: cachedVideoModels, loading: videoModelsLoading } = useRawAiModels(
    AI_MODEL_PATHS.video
  );
  const models = (isVideo ? cachedVideoModels : cachedImageModels) as RawAiModel[];
  const loadingModels = isVideo ? videoModelsLoading : imageModelsLoading;
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
  const [videoSize, setVideoSize] = useState("");
  const [videoLength, setVideoLength] = useState("");
  const [skipFinalizedImage, setSkipFinalizedImage] = useState(false);
  const [skipFinalizedVideo, setSkipFinalizedVideo] = useState(true);

  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: item.serviceName ?? item.serviceCode ?? "",
        value: String(item.serviceCode ?? ""),
      })),
    [models]
  );

  const currentModel = useMemo(
    () => models.find((item) => String(item.serviceCode ?? "") === model),
    [model, models]
  );
  const currentModelCost = Math.abs(Number(currentModel?.integralCost ?? 0));
  const sizeOptions = useMemo(() => parseImageSizes(currentModel), [currentModel]);
  const videoDescription = useMemo(() => parseVideoDescription(currentModel), [currentModel]);

  const [prevModels, setPrevModels] = useState(models);
  if (prevModels !== models && models.length > 0) {
    setPrevModels(models);
    const defaultModelCode =
      models.find((item) => item.isDefault)?.serviceCode ?? models[0]?.serviceCode ?? "";
    const defaultModel = models.find(
      (item) => String(item.serviceCode ?? "") === String(defaultModelCode)
    );
    setModel(String(defaultModelCode));
    if (isVideo) {
      const defaults = getDefaultVideoSettings(defaultModel);
      setVideoSize(defaults.videoSize);
      setVideoLength(defaults.videoLength);
    } else {
      setSize(getPreferredImageSize(parseImageSizes(defaultModel), projectSize));
    }
  }

  const handleModelChange = (nextModelCode: string) => {
    setModel(nextModelCode);
    const nextModel = models.find((item) => String(item.serviceCode ?? "") === nextModelCode);
    if (isVideo) {
      const defaults = getDefaultVideoSettings(nextModel);
      setVideoSize(defaults.videoSize);
      setVideoLength(defaults.videoLength);
      return;
    }
    setSize(getPreferredImageSize(parseImageSizes(nextModel), projectSize));
  };

  const handleConfirm = () => {
    onConfirm({
      model,
      size: isVideo ? "" : size,
      regenerateFinalized: isVideo ? !skipFinalizedVideo : !skipFinalizedImage,
      videoSize: isVideo ? videoSize || undefined : undefined,
      videoLength: isVideo && videoLength ? Number(videoLength) : undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!loading ? onOpenChange(next) : undefined)}>
      <DialogContent
        showCloseButton={!loading}
        className="gap-0 rounded-xl border border-border bg-[#262626] p-0 text-white sm:max-w-[540px]"
      >
        <DialogHeader className="border-b border-white/10 px-6 py-4">
          <DialogTitle>{isVideo ? t("batchGenerateVideos") : t("batchGenerateImages")}</DialogTitle>
          <DialogDescription className="text-xs text-[#8F8F92]">
            {isVideo ? t("batchGenerateVideosDesc") : t("batchGenerateImagesDesc")}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="px-6 py-5">
          <Field>
            <FieldLabel>{t("modelLabel")}</FieldLabel>
            <NativeSelect
              value={model}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={loading || loadingModels}
              className="w-full"
            >
              <NativeSelectOption value="" disabled>
                {loadingModels ? t("loadingModels") : t("selectModel")}
              </NativeSelectOption>
              {modelOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {currentModelCost ? (
              <FieldDescription className="text-[#8F8F92]">
                {isVideo
                  ? t("costPerVideo", { cost: currentModelCost })
                  : t("costPerImage", { cost: currentModelCost })}
              </FieldDescription>
            ) : null}
          </Field>

          {!isVideo ? (
            <>
              <Field>
                <FieldLabel>{t("sizeLabel")}</FieldLabel>
                <NativeSelect
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  disabled={loading || !sizeOptions.length}
                  className="w-full"
                >
                  <NativeSelectOption value="" disabled>
                    {sizeOptions.length ? t("selectSize") : t("noSizeAvailable")}
                  </NativeSelectOption>
                  {sizeOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                orientation="horizontal"
                className="items-start rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3"
              >
                <Checkbox
                  checked={skipFinalizedImage}
                  onCheckedChange={(checked) => setSkipFinalizedImage(Boolean(checked))}
                  disabled={loading}
                />
                <div className="space-y-1">
                  <FieldLabel className="text-sm font-medium">
                    {t("skipFinalizedImages")}
                  </FieldLabel>
                  <FieldDescription className="text-xs text-[#8F8F92]">
                    {t("skipFinalizedImagesDesc")}
                  </FieldDescription>
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel>{t("videoSizeLabel")}</FieldLabel>
                <NativeSelect
                  value={videoSize}
                  onChange={(event) => setVideoSize(event.target.value)}
                  disabled={loading || !videoDescription.sizes.length}
                  className="w-full"
                >
                  <NativeSelectOption value="" disabled>
                    {videoDescription.sizes.length
                      ? t("selectVideoSize")
                      : t("noVideoSizeAvailable")}
                  </NativeSelectOption>
                  {videoDescription.sizes.map((option: string) => (
                    <NativeSelectOption key={option} value={option}>
                      {option}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              <Field>
                <FieldLabel>{t("videoDurationLabel")}</FieldLabel>
                <NativeSelect
                  value={videoLength}
                  onChange={(event) => setVideoLength(event.target.value)}
                  disabled={loading || !videoDescription.videoLengths.length}
                  className="w-full"
                >
                  <NativeSelectOption value="" disabled>
                    {videoDescription.videoLengths.length
                      ? t("selectVideoDuration")
                      : t("noVideoDurationAvailable")}
                  </NativeSelectOption>
                  {videoDescription.videoLengths.map((option: number) => (
                    <NativeSelectOption key={option} value={String(option)}>
                      {option}s
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                orientation="horizontal"
                className="items-start rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3"
              >
                <Checkbox
                  checked={skipFinalizedVideo}
                  onCheckedChange={(checked) => setSkipFinalizedVideo(Boolean(checked))}
                  disabled={loading}
                />
                <div className="space-y-1">
                  <FieldLabel className="text-sm font-medium">
                    {t("skipFinalizedVideos")}
                  </FieldLabel>
                  <FieldDescription className="text-xs text-[#8F8F92]">
                    {t("skipFinalizedVideosDesc")}
                  </FieldDescription>
                </div>
              </Field>
            </>
          )}
        </FieldGroup>

        <DialogFooter className="border-white/10 bg-transparent">
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {tc("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !model || (!isVideo && !size)}
            className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
          >
            {loading ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
