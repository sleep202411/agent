"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsMaximize,
  IconBrush,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconDownload,
  IconEraser,
  IconFileText,
  IconPencil,
  IconRotate360,
  IconScissors,
  IconShieldCheck,
  IconStar,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { getModeConfig } from "@/components/ui/schema-field/schema";
import { useAiModels } from "@/src/hooks/use-ai-models";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import type { ToolbarAction } from "@/components/ui/floating-toolbar";
import { MediaPreviewPanel } from "./media-preview-panel";
import { PromptInput } from "./prompt-input";
import {
  ReferenceMapProvider,
  type ReferenceMap,
} from "@/app/projects/_components/storyboard/editor/reference-map-context";
import {
  buildReferenceMap,
  extractMentionsFromHtml,
  removeMentionsByUrls,
} from "@/app/projects/_components/storyboard/editor/build-reference-map";
import { ResultGallery } from "./result-gallery";
import { backendApi } from "@/src/lib/api";
import { submitImageTask, retryImageTask } from "@/src/lib/ai-image-queue";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";

import {
  deleteImageItem,
  initImageInstance,
  loadImageHistory,
  selectAllImageResults,
  setImagePreview,
  updateImageForm,
  type ResultItem,
  selectActiveEpisode as selectActiveProjectEpisode,
  selectCurrentInstance,
  setEpisodes,
} from "@/src/store/slices/projectSlice";

interface AiImageGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId: string;
  shotColumnId: string;
  shotNumber?: number;
  defaultPrompt?: string;
  defaultRefImage?: string;
  referenceFields?: string[];
  appliedPaths?: string[];
  preferredPath?: string;
  onCollect?: (item: ResultItem) => void;
  onSetPreferred?: (item: ResultItem) => void;
  onGeneratePrompt?: (prompt: string) => void;
  onPrevShot?: () => void;
  onNextShot?: () => void;
}

export function AiImageGeneratorDialog({
  open,
  onOpenChange,
  shotId,
  shotColumnId,
  shotNumber,
  defaultPrompt,
  defaultRefImage,
  referenceFields = [],
  appliedPaths = [],
  preferredPath,
  onCollect,
  onSetPreferred,
  onGeneratePrompt,
  onPrevShot,
  onNextShot,
}: AiImageGeneratorDialogProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [prefixPrompt, setPrefixPrompt] = useState("");
  const [suffixPrompt, setSuffixPrompt] = useState("");
  const activeEpisode = useAppSelector((s) => selectActiveProjectEpisode(s));
  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState("imageGenerate");
  const [imagePickerOpen, setImagePickerOpen] = useState(false);

  const promptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from store when episode prompts change externally
  const storeFront = String(activeEpisode?.frontPrompt ?? "");
  const storeBehind = String(activeEpisode?.behindPrompt ?? "");
  useEffect(() => {
    if (!promptSaveTimerRef.current) setPrefixPrompt(storeFront);
  }, [storeFront]);
  useEffect(() => {
    if (!promptSaveTimerRef.current) setSuffixPrompt(storeBehind);
  }, [storeBehind]);

  const saveEpisodePrompts = useCallback((front: string, behind: string) => {
    if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current);
    promptSaveTimerRef.current = setTimeout(() => {
      const episode = selectActiveProjectEpisode(store.getState());
      if (!episode?.id) return;
      store.dispatch(
        setEpisodes(
          selectCurrentInstance(store.getState()).episodes.map((item) =>
            String(item.id ?? "") === String(episode.id)
              ? { ...item, frontPrompt: front.trim(), behindPrompt: behind.trim() }
              : item
          )
        )
      );
      const projectId = selectCurrentInstance(store.getState()).detail?.id;
      backendApi
        .post("/api/user/world/update/episode", {
          data: {
            id: episode.id,
            projectId,
            frontPrompt: front.trim(),
            behindPrompt: behind.trim(),
          },
        })
        .catch((err) => console.warn("[AiImageGeneratorDialog] save prompts failed:", err));
    }, 500);
  }, []);

  const handlePrefixChange = (value: string) => {
    setPrefixPrompt(value);
    saveEpisodePrompts(value, suffixPrompt);
  };

  const handleSuffixChange = (value: string) => {
    setSuffixPrompt(value);
    saveEpisodePrompts(prefixPrompt, value);
  };

  const key = `${shotId}_${shotColumnId}`;
  const inst = useAppSelector((s) => selectCurrentInstance(s).aiImageForm.instances[key]);
  const formData = inst?.formData ?? {
    prompt: "",
    model: "",
    size: "",
    count: 1,
    referenceImages: [],
  };
  const previewItem = inst?.previewItem ?? null;
  const historyLoading = inst?.historyLoading ?? false;

  const allResults = useAppSelector((s) => selectAllImageResults(s, shotId, shotColumnId));

  // Models from backend cache, driven by imageMode
  const modeConfig = getModeConfig(imageMode);
  const { models: modeModels } = useAiModels(modeConfig?.endpoint ?? "");
  const currentModel = useMemo(
    () => modeModels.find((m) => m.id === formData.model),
    [modeModels, formData.model]
  );

  // normalizedModels used by ModelPicker card UI — same source now
  const normalizedModels = modeModels;

  const maxRefImages = currentModel?.maxImages ?? 3;
  const minRefImages = currentModel?.minImages ?? 0;

  const sizeField = currentModel?.inputSchema?.properties?.size;
  const sizeOptions = useMemo(() => {
    if (!sizeField?.enum) return [];
    const labels = sizeField["x-enum-labels"] ?? {};
    return sizeField.enum.map((v) => ({
      label: labels[String(v)] ?? String(v),
      value: String(v),
    }));
  }, [sizeField]);

  const modelOptions = useMemo(
    () => modeModels.map((m) => ({ label: m.name, value: m.id })),
    [modeModels]
  );

  const cost = (currentModel?.cost ?? 0) * (formData.count || 1);
  const title = shotNumber ? t("aiImageTitle", { number: shotNumber }) : t("aiImageTitleDefault");

  useEffect(() => {
    if (!open) return;

    const hasInstance = !!selectCurrentInstance(store.getState()).aiImageForm.instances[key];

    if (!hasInstance) {
      store
        .dispatch(
          initImageInstance({
            shotId,
            colId: shotColumnId,
            opts: { defaultPrompt, defaultRefImage },
          })
        )
        .then(() => {
          const prompt = selectCurrentInstance(store.getState()).aiImageForm.instances[key]
            ?.formData?.prompt;
          if (prompt) syncMentionRefs(prompt);
        });
    } else {
      store.dispatch(loadImageHistory({ shotId, colId: shotColumnId })).catch((error) => {
        console.error("[AiImageGeneratorDialog] 刷新生图历史失败:", error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultPrompt/defaultRefImage are only used during initInstance; changes after init should not reload history
  }, [key, open, shotColumnId, shotId]);

  const previewUrl = previewItem?.url;
  const isPreviewApplied = previewItem?.storagePath
    ? appliedPaths.includes(previewItem.storagePath)
    : false;
  const isPreviewPreferred = previewItem?.storagePath === preferredPath;

  const handleUpdateForm = (updates: Partial<typeof formData>) =>
    store.dispatch(updateImageForm({ shotId, colId: shotColumnId, updates }));

  // Auto-select default model + size when mode changes or no model selected
  useEffect(() => {
    if (modeModels.length === 0) return;
    const matched = modeModels.find((m) => m.id === formData.model);
    if (!matched) {
      const defaultModel = modeModels.find((m) => m.isDefault) ?? modeModels[0];
      if (defaultModel) {
        const defaultSize = defaultModel.inputSchema?.properties?.size?.default;
        handleUpdateForm({
          model: defaultModel.id,
          ...(defaultSize ? { size: String(defaultSize) } : {}),
        });
      }
    }
  }, [imageMode, modeModels, formData.model]); // eslint-disable-line react-hooks/exhaustive-deps

  // Truncate referenceImages when mode maxCount changes + clean prompt for dropped items
  useEffect(() => {
    if (formData.referenceImages.length > maxRefImages) {
      const kept = formData.referenceImages.slice(0, maxRefImages);
      const dropped = formData.referenceImages.slice(maxRefImages);

      const urlsToRemove = new Set<string>();
      for (const item of dropped) {
        if (item.url) urlsToRemove.add(item.url);
        if (item.path) urlsToRemove.add(item.path);
      }

      const cleanedPrompt = removeMentionsByUrls(formData.prompt, urlsToRemove);
      const updates: Partial<typeof formData> = { referenceImages: kept };
      if (cleanedPrompt !== formData.prompt) updates.prompt = cleanedPrompt;
      handleUpdateForm(updates);
    }
  }, [maxRefImages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync @mention images → reference group ──
  // Called on every prompt change: extracts <mention imgUrl> tags and adds new ones to refs.
  const syncMentionRefs = (promptHtml: string) => {
    if (!promptHtml.includes("<mention")) return;
    const mentionRegex = /<mention\s+([^>]*)>([^<]*)<\/mention>/gi;
    const currentRefs =
      selectCurrentInstance(store.getState()).aiImageForm.instances[key]?.formData
        ?.referenceImages ?? [];
    const existing = new Set(
      currentRefs.map((r: { url?: string; path: string }) => r.url || r.path)
    );
    const newItems: { url: string; path: string; label: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(promptHtml)) !== null) {
      const attrs = match[1];
      const name = match[2];
      const url = attrs.match(/imgUrl="([^"]*)"/i)?.[1] ?? "";
      const type = attrs.match(/type="([^"]*)"/)?.[1] ?? "reference";
      if (!url || url === "null" || existing.has(url)) continue;
      existing.add(url);
      const isNamed = ["character", "scene", "prop"].includes(type);
      const label = isNamed && name ? name : undefined;
      newItems.push({ url, path: url, label: label ?? "" });
    }
    if (newItems.length > 0) {
      handleUpdateForm({
        referenceImages: [...currentRefs, ...newItems].slice(0, maxRefImages),
      });
    }
  };

  // ─── Delete reference → also remove mention from prompt ──
  const handleRemoveReference = useCallback(
    (index: number) => {
      const removed = formData.referenceImages[index];
      const newRefs = formData.referenceImages.filter((_, i) => i !== index);

      const urlsToRemove = new Set<string>();
      if (removed?.url) urlsToRemove.add(removed.url);
      if (removed?.path) urlsToRemove.add(removed.path);

      const cleanedPrompt = removeMentionsByUrls(formData.prompt, urlsToRemove);

      const updates: Partial<typeof formData> = { referenceImages: newRefs };
      if (cleanedPrompt !== formData.prompt) {
        updates.prompt = cleanedPrompt;
      }
      handleUpdateForm(updates);
    },
    [formData.referenceImages, formData.prompt, handleUpdateForm]
  );

  const handleModelChange = (value: string) => {
    const matchedModel = modeModels.find((m) => m.id === value);
    const defaultSize = matchedModel?.inputSchema?.properties?.size?.default;
    const newMax = maxRefImages;
    const trimmedRefs =
      formData.referenceImages.length > newMax
        ? formData.referenceImages.slice(0, newMax)
        : undefined;
    handleUpdateForm({
      model: value,
      ...(defaultSize ? { size: String(defaultSize) } : {}),
      ...(trimmedRefs ? { referenceImages: trimmedRefs } : {}),
    });
  };

  const handleClose = () => {
    setFullPreviewUrl(null);
    setImagePickerOpen(false);
    onOpenChange(false);
  };

  const isEditLikeMode = imageMode === "imageEdit";

  const handleGenerate = () => {
    if (!modeConfig) return;

    const isEdit = isEditLikeMode;
    const fullPrompt = isEdit
      ? formData.prompt.trim()
      : [prefixPrompt.trim(), formData.prompt.trim(), suffixPrompt.trim()]
          .filter(Boolean)
          .join("\n");

    if (!fullPrompt) {
      toast.warning(t("enterPrompt"));
      return;
    }

    const refImages = formData.referenceImages
      .map((item) => {
        const p = item.path || item.url || "";
        return p.startsWith("http") ? p : buildOssUrl(p);
      })
      .filter(Boolean);

    // Edit-like modes require at least one reference image
    if (isEdit && refImages.length === 0) {
      toast.warning(t("uploadReferenceFirst"));
      return;
    }

    // Model-declared minimum reference images (e.g. happy horse: [1, 9])
    if (minRefImages > 0 && refImages.length < minRefImages) {
      toast.warning(t("uploadAtLeastImages", { count: minRefImages }));
      return;
    }

    onGeneratePrompt?.(formData.prompt.trim());

    const count = formData.count || 1;
    const refUrl = refImages
      .map((p) => buildOssUrl(p))
      .filter(Boolean)
      .join(";");

    for (let index = 0; index < count; index += 1) {
      submitImageTask({
        shotId,
        shotColumnId,
        prompt: fullPrompt,
        model: formData.model,
        size: formData.size,
        endpoint: modeConfig.endpoint,
        ...(isEdit
          ? { images: refImages, mode: "edit" as const, promptExtend: true }
          : { referenceImageUrl: refUrl || undefined }),
        watermark: false,
      });
    }

    toast.success(t("addedGenerateTasks", { count }));
  };

  const handlePreview = (item: ResultItem) => {
    store.dispatch(setImagePreview({ shotId: shotId, colId: shotColumnId, item: item }));
  };

  const handleDelete = async (item: ResultItem) => {
    try {
      await store.dispatch(deleteImageItem({ shotId, colId: shotColumnId, item }));
    } catch {
      toast.error(tc("deleteFailed"));
    }
  };

  const handleRetry = (item: ResultItem) => {
    retryImageTask(item.id);
  };

  const handleDownload = (item: ResultItem) => {
    if (!item.url) return;
    const link = document.createElement("a");
    link.href = item.url;
    link.download = "";
    link.click();
  };

  const handleAddReference = (paths: string[]) => {
    const newRefs = [
      ...formData.referenceImages,
      ...paths.map((path) => ({ url: buildOssUrl(path), path })),
    ].slice(0, maxRefImages);
    handleUpdateForm({ referenceImages: newRefs });
  };

  const imageToolbarActions: ToolbarAction[] = [
    onCollect && {
      key: "collect",
      icon: <IconStar className="size-4" />,
      active: isPreviewApplied,
      title: isPreviewApplied ? t("removeAction") : t("addAction"),
      onClick: () => previewItem && onCollect(previewItem),
    },
    onSetPreferred && {
      key: "prefer",
      icon: <IconCircleCheck className="size-4" />,
      active: isPreviewPreferred,
      title: isPreviewPreferred ? t("cancelFinalize") : t("setFinalize"),
      onClick: () => previewItem && onSetPreferred(previewItem),
    },
    {
      key: "download",
      icon: <IconDownload className="size-4" />,
      title: tc("download"),
      onClick: () => {
        if (!previewUrl) return;
        const link = document.createElement("a");
        link.href = previewUrl;
        link.download = "";
        link.click();
      },
    },
    {
      key: "delete",
      icon: <IconTrash className="size-4" />,
      title: tc("delete"),
      onClick: () => previewItem && handleDelete(previewItem),
    },
    {
      key: "fullscreen",
      icon: <IconArrowsMaximize className="size-4" />,
      title: t("fullscreenPreview"),
      onClick: () => setFullPreviewUrl(previewUrl || null),
    },
    previewItem?.other && {
      key: "meta",
      icon: <IconFileText className="size-4" />,
      title: t("viewDetails"),
      metaContent: previewItem.other,
    },
  ].filter(Boolean) as ToolbarAction[];

  const actionItems = [
    {
      key: "edit",
      label: t("editAction"),
      icon: <IconPencil className="size-3.5" />,
      active: imageMode === "imageEdit",
      onClick: () => {
        const nextMode = imageMode === "imageEdit" ? "imageGenerate" : "imageEdit";
        setImageMode(nextMode);
        // Edit mode: replace references with only the preview image (maxCount=1)
        if (nextMode === "imageEdit" && previewItem?.storagePath) {
          handleUpdateForm({
            referenceImages: [{ path: previewItem.storagePath, url: previewItem.url ?? "" }],
          });
        }
      },
    },
    {
      key: "repaint",
      label: t("repaintAction"),
      icon: <IconBrush className="size-3.5" />,
      disabled: true,
      title: tc("comingSoon"),
    },
    {
      key: "erase",
      label: t("eraseAction"),
      icon: <IconEraser className="size-3.5" />,
      disabled: true,
      title: tc("comingSoon"),
    },
    {
      key: "enhance",
      label: t("enhanceAction"),
      icon: <IconShieldCheck className="size-3.5" />,
      disabled: true,
      title: tc("comingSoon"),
    },
    {
      key: "cutout",
      label: t("cutoutAction"),
      icon: <IconScissors className="size-3.5" />,
      disabled: true,
      title: tc("comingSoon"),
    },
    {
      key: "multi-angle",
      label: t("multiAngleAction"),
      icon: <IconRotate360 className="size-3.5" />,
      disabled: true,
      title: tc("comingSoon"),
    },
  ];

  // ─── Reference map: sync prompt chips ↔ reference group ──
  const promptMentions = useMemo(() => extractMentionsFromHtml(formData.prompt), [formData.prompt]);
  const refPrefix = t("referenceImage");
  const referenceMap: ReferenceMap = useMemo(
    () => buildReferenceMap(formData.referenceImages, promptMentions, refPrefix),
    [formData.referenceImages, promptMentions, refPrefix]
  );
  const refIsFull = formData.referenceImages.length >= maxRefImages;
  const referenceMapCtx = useMemo(
    () => ({ map: referenceMap, isFull: refIsFull }),
    [referenceMap, refIsFull]
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="flex w-[980px] sm:max-w-[980px] flex-col overflow-visible p-0"
        style={{ height: "min(860px, 90vh)" }}
      >
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
          <div className="flex flex-4 flex-col overflow-auto">
            <ResultGallery
              items={allResults}
              loading={historyLoading}
              columns={4}
              showActions={false}
              appliedPaths={appliedPaths}
              preferredPath={preferredPath}
              previewItemId={previewItem?.id}
              onPreview={handlePreview}
              onDelete={handleDelete}
              onCollect={onCollect}
              onSetPreferred={onSetPreferred}
              onDownload={handleDownload}
              onRetry={handleRetry}
            />
          </div>

          <MediaPreviewPanel
            type="image"
            previewUrl={previewUrl ?? ""}
            emptyText={t("clickLeftImagePreview")}
            className="flex-[6]"
            toolbarActions={imageToolbarActions}
            bottomActions={actionItems}
          />
        </div>

        <ReferenceMapProvider value={referenceMapCtx}>
          <PromptInput
            imageMode={imageMode}
            onImageModeChange={setImageMode}
            prompt={formData.prompt}
            onPromptChange={(value) => {
              handleUpdateForm({ prompt: value });
              syncMentionRefs(value);
            }}
            prefixPrompt={prefixPrompt}
            onPrefixChange={handlePrefixChange}
            suffixPrompt={suffixPrompt}
            onSuffixChange={handleSuffixChange}
            model={formData.model}
            modelOptions={modelOptions}
            normalizedModels={normalizedModels}
            onModelChange={handleModelChange}
            size={formData.size}
            sizeOptions={sizeOptions}
            onSizeChange={(value) => handleUpdateForm({ size: value })}
            count={formData.count}
            onCountChange={(value) => handleUpdateForm({ count: value })}
            referenceImages={formData.referenceImages}
            maxReferenceImages={maxRefImages}
            onAddReference={() => setImagePickerOpen(true)}
            onRemoveReference={handleRemoveReference}
            referenceFields={referenceFields}
            cost={cost}
            hideExtraPrompts={isEditLikeMode}
            onSubmit={handleGenerate}
            mentionDisabled={refIsFull}
          />
        </ReferenceMapProvider>
        {onPrevShot ? (
          <button
            type="button"
            onClick={onPrevShot}
            className="fixed top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
            style={{ left: "calc(50% - 554px)" }}
          >
            <IconChevronLeft className="size-5" />
          </button>
        ) : null}
        {onNextShot ? (
          <button
            type="button"
            onClick={onNextShot}
            className="fixed top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
            style={{ right: "calc(50% - 554px)" }}
          >
            <IconChevronRight className="size-5" />
          </button>
        ) : null}
      </DialogContent>

      <AssetPickerDialog
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        assetType="img"
        onSelect={handleAddReference}
        multiple
      />

      <MediaPreviewModal
        open={!!fullPreviewUrl}
        onOpenChange={(open) => {
          if (!open) setFullPreviewUrl(null);
        }}
        type="image"
        src={fullPreviewUrl}
        prompt={formData.prompt}
      />
    </Dialog>
  );
}
