"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { cn } from "@/lib/utils";
import type { ToolbarAction } from "@/components/ui/floating-toolbar";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
import { MediaPreviewPanel } from "./media-preview-panel";
import { PromptInput } from "./prompt-input";
import { ResultGallery } from "./result-gallery";
import { backendApi } from "@/src/lib/api";
import { submitImageTask, retryImageTask } from "@/src/lib/ai-image-queue";
import { useTranslations } from "next-intl";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import {
  deleteImageItem,
  initImageInstance,
  loadImageEditModels,
  loadImageHistory,
  selectAllImageResults,
  selectImageInstance,
  setImageCurrentEditModel,
  setImageCurrentModel,
  setImagePreview,
  updateImageForm,
  type ResultItem,
  selectActiveEpisode as selectActiveProjectEpisode,
  selectCurrentInstance,
  setEpisodes,
} from "@/src/store/slices/projectSlice";

const EDIT_MODE_MAX_REFERENCES = 3;
const EMPTY_AI_MODELS: never[] = [];

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [savedModel, setSavedModel] = useState("");
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
      backendApi
        .post("/api/user/world/update/episode", {
          data: { id: episode.id, frontPrompt: front.trim(), behindPrompt: behind.trim() },
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
  const models = useAppSelector((s) => selectCurrentInstance(s).aiImageForm.models);
  const editModels = useAppSelector((s) => selectCurrentInstance(s).aiImageForm.editModels);
  const currentModelGlobal = useAppSelector(
    (s) => selectCurrentInstance(s).aiImageForm.currentModel
  );
  const currentEditModelGlobal = useAppSelector(
    (s) => selectCurrentInstance(s).aiImageForm.currentEditModel
  );

  const allResults = selectAllImageResults(store.getState(), shotId, shotColumnId);

  // Use preloaded normalized models from cache (stable empty ref to avoid re-renders)
  const cachedModels =
    useAppSelector((s) => s.aiModelCache.aiModelCache["/api/ai/image/generate/basic"]) ??
    EMPTY_AI_MODELS;
  const cachedEditModels =
    useAppSelector((s) => s.aiModelCache.aiModelCache["/api/ai/image/edit/wan"]) ?? EMPTY_AI_MODELS;

  const displayedModels = isEditMode ? editModels : models;
  const currentModel = isEditMode ? currentEditModelGlobal : currentModelGlobal;

  const normalizedModels = isEditMode ? cachedEditModels : cachedModels;
  const modelOptions = normalizedModels.map((m) => ({
    label: m.description ? `${m.name} · ${m.description}` : m.name,
    value: m.id,
  }));

  const selectedNormalized = normalizedModels.find((m) => m.id === formData.model);
  const sizeEnum = selectedNormalized?.inputSchema?.properties?.size?.enum ?? [];
  const sizeLabels = selectedNormalized?.inputSchema?.properties?.size?.["x-enum-labels"] ?? {};
  const sizeOptions = sizeEnum.map((v) => ({
    label: sizeLabels[String(v)] ?? String(v),
    value: String(v),
  }));

  const cost = (selectedNormalized?.cost ?? 0) * (formData.count || 1);
  const title = shotNumber ? t("aiImageTitle", { number: shotNumber }) : t("aiImageTitleDefault");

  useEffect(() => {
    if (!open) return;

    const hasInstance = !!selectCurrentInstance(store.getState()).aiImageForm.instances[key];

    if (!hasInstance) {
      store.dispatch(
        initImageInstance({ shotId, colId: shotColumnId, opts: { defaultPrompt, defaultRefImage } })
      );
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

  // Auto-select default model when no model is selected
  useEffect(() => {
    if (formData.model || normalizedModels.length === 0) return;
    const defaultModel = normalizedModels.find((m) => m.isDefault) ?? normalizedModels[0];
    if (defaultModel) {
      handleUpdateForm({ model: defaultModel.id });
      // Also set default size
      const defaultSize = defaultModel.inputSchema.properties.size?.default;
      if (defaultSize) handleUpdateForm({ model: defaultModel.id, size: String(defaultSize) });
    }
  }, [normalizedModels, formData.model]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleModelChange = (value: string) => {
    handleUpdateForm({ model: value });

    const matched = displayedModels.find((item) => item.serviceCode === value);
    if (!matched) return;

    if (isEditMode) {
      store.dispatch(setImageCurrentEditModel(matched));
    } else {
      store.dispatch(setImageCurrentModel(matched));
    }
  };

  const enterEditMode = async () => {
    await store.dispatch(loadImageEditModels());

    if (!isEditMode) {
      setSavedModel(formData.model);
    }

    const latestAiForm = selectCurrentInstance(store.getState()).aiImageForm;
    const editModel =
      latestAiForm.currentEditModel ??
      latestAiForm.editModels.find((item) => item.isDefault) ??
      latestAiForm.editModels[0];

    if (editModel?.serviceCode) {
      store.dispatch(setImageCurrentEditModel(editModel));
      handleUpdateForm({ model: editModel.serviceCode });
    }

    if (previewItem?.url) {
      handleUpdateForm({
        referenceImages: [
          {
            url: previewItem.url,
            path: previewItem.storagePath || previewItem.url,
          },
        ],
      });
    }

    setIsEditMode(true);
  };

  const exitEditMode = () => {
    setIsEditMode(false);

    if (savedModel) {
      handleUpdateForm({ model: savedModel });
      setSavedModel("");
    }

    if (formData.referenceImages.length > 5) {
      handleUpdateForm({ referenceImages: formData.referenceImages.slice(0, 5) });
    }
  };

  const handleToggleEditMode = () => {
    if (isEditMode) {
      exitEditMode();
      return;
    }
    void enterEditMode();
  };

  const handleClose = () => {
    if (isEditMode && savedModel) {
      store.dispatch(
        updateImageForm({ shotId, colId: shotColumnId, updates: { model: savedModel } })
      );
    }
    setIsEditMode(false);
    setSavedModel("");
    setFullPreviewUrl(null);
    setImagePickerOpen(false);
    onOpenChange(false);
  };

  const handleGenerate = () => {
    if (isEditMode) {
      const prompt = formData.prompt.trim();
      if (!prompt) {
        toast.warning(t("enterPrompt"));
        return;
      }

      const images = formData.referenceImages.map((item) => item.path).filter(Boolean);
      if (images.length === 0) {
        toast.warning(t("uploadReferenceFirst"));
        return;
      }

      onGeneratePrompt?.(prompt);

      const count = formData.count || 1;
      for (let index = 0; index < count; index += 1) {
        submitImageTask({
          shotId,
          shotColumnId,
          prompt,
          model: formData.model,
          size: formData.size,
          images,
          mode: "edit",
          promptExtend: true,
          watermark: false,
        });
      }
      toast.success(t("addedEditTasks", { count }));
      return;
    }

    const fullPrompt = [prefixPrompt.trim(), formData.prompt.trim(), suffixPrompt.trim()]
      .filter(Boolean)
      .join("\n");
    if (!fullPrompt) {
      toast.warning(t("enterPrompt"));
      return;
    }

    onGeneratePrompt?.(formData.prompt.trim());

    const refUrl = formData.referenceImages
      .map((img) => (img.path ? buildOssUrl(img.path) : ""))
      .filter(Boolean)
      .join(";");

    const count = formData.count || 1;
    for (let index = 0; index < count; index += 1) {
      submitImageTask({
        shotId,
        shotColumnId,
        prompt: fullPrompt,
        model: formData.model,
        size: formData.size,
        referenceImageUrl: refUrl || undefined,
        watermark: false,
      });
    }

    toast.success(t("addedGenerateTasks", { count }));
  };

  const handlePreview = (item: ResultItem) => {
    store.dispatch(setImagePreview({ shotId: shotId, colId: shotColumnId, item: item }));
    if (isEditMode) {
      exitEditMode();
    }
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
    const limit = isEditMode ? EDIT_MODE_MAX_REFERENCES : 5;
    const newRefs = [
      ...formData.referenceImages,
      ...paths.map((path) => ({ url: buildOssUrl(path), path })),
    ].slice(0, limit);
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
      active: isEditMode,
      onClick: handleToggleEditMode,
    },
    {
      key: "repaint",
      label: t("repaintAction"),
      icon: <IconBrush className="size-3.5" />,
    },
    {
      key: "erase",
      label: t("eraseAction"),
      icon: <IconEraser className="size-3.5" />,
    },
    {
      key: "enhance",
      label: t("enhanceAction"),
      icon: <IconShieldCheck className="size-3.5" />,
    },
    {
      key: "cutout",
      label: t("cutoutAction"),
      icon: <IconScissors className="size-3.5" />,
    },
    {
      key: "multi-angle",
      label: t("multiAngleAction"),
      icon: <IconRotate360 className="size-3.5" />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="flex w-[980px] sm:max-w-[980px] flex-col overflow-visible p-0"
        style={{ height: "min(860px, 90vh)" }}
      >
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-4">
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

        <PromptInput
          prompt={formData.prompt}
          onPromptChange={(value) => handleUpdateForm({ prompt: value })}
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
          onAddReference={() => setImagePickerOpen(true)}
          onRemoveReference={(index) =>
            handleUpdateForm({
              referenceImages: formData.referenceImages.filter(
                (_, innerIndex) => innerIndex !== index
              ),
            })
          }
          referenceFields={referenceFields}
          cost={cost}
          editMode={isEditMode}
          showEditToggle
          hideExtraPrompts={isEditMode}
          onToggleEditMode={handleToggleEditMode}
          onSubmit={handleGenerate}
        />
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

      {fullPreviewUrl ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
          onClick={() => setFullPreviewUrl(null)}
        >
          <img
            src={fullPreviewUrl}
            alt=""
            className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setFullPreviewUrl(null)}
            className="absolute right-6 top-6 flex size-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30"
          >
            <IconX className="size-5" />
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}
