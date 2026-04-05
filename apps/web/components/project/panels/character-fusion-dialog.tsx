"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  IconArrowsMaximize,
  IconCheck,
  IconDownload,
  IconLoader2,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconReplace,
  IconTrash,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResultGallery } from "@/components/storyboard/ai-generator/result-gallery";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { RawAiModel, AssetRecord } from "@/src/types/workspace";
import type { ResultItem } from "@/src/store/slices/projectSlice";
import type { Asset } from "@/src/store/slices/projectSlice";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";
const PROP_PAGE_SIZE = 100;

type FusionCharacter = {
  id?: string;
  name?: string;
  description?: string;
  prompt?: string;
  roleImgPath?: string[];
  otherImgPath?: string | Record<string, string>;
};

type ExistingRole = {
  otherImgPath?: string | Record<string, string>;
};

type PropOption = {
  id: string;
  name: string;
  image: string;
};

type FusionTaskParams = {
  prompt: string;
  model?: string;
  worldRoleId: number;
  characterImageUrl: string;
  propImageUrls: string[];
};

type FusionQueueItem = ResultItem & {
  params?: FusionTaskParams;
};

function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

function normalizeStoragePath(path?: string | null) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const prefix = `${OSS_BASE}/`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return raw;
}

function parseObjectSafely(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed ?? {})
          .map(([key, item]) => [String(key), String(item ?? "").trim()])
          .filter(([, item]) => item)
      );
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [String(key), String(item ?? "").trim()])
        .filter(([, item]) => item)
    );
  }
  return {};
}

function findDefaultModel(models: RawAiModel[]) {
  return models.find((item) => item.isDefault)?.serviceCode || models[0]?.serviceCode || "";
}

async function loadAllProps(worldId: string) {
  if (!worldId) return [] as PropOption[];
  const items: PropOption[] = [];
  let page = 1;
  while (true) {
    const response = await backendApi.post<Paginated<Asset>>("/api/user/world/list/worldprop", {
      data: { worldId, page, pageSize: PROP_PAGE_SIZE },
    });
    const list = (response?.list ?? []) as Asset[];
    items.push(
      ...list.map((item) => {
        const extraImage = (() => {
          const imagePaths = Array.isArray((item as { imagePaths?: unknown }).imagePaths)
            ? ((item as { imagePaths?: string[] }).imagePaths ?? [])
            : [];
          const imagePath =
            typeof (item as { imagePath?: unknown }).imagePath === "string"
              ? ((item as { imagePath?: string }).imagePath ?? "")
              : "";
          return imagePaths[0] ?? imagePath;
        })();
        return {
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
          image: String(item.propImgPath?.[0] ?? item.thumbnail ?? extraImage),
        };
      })
    );
    if (list.length < PROP_PAGE_SIZE) break;
    page += 1;
  }
  return items;
}

function downloadUrl(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
}

function PropPickerDialog({
  open,
  onOpenChange,
  items,
  value,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PropOption[];
  value: PropOption[];
  onConfirm: (items: PropOption[]) => void;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const tp = useTranslations("prop");
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const visibleItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return items;
    return items.filter((item) => item.name.toLowerCase().includes(normalizedKeyword));
  }, [items, keyword]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        onOpenAutoFocus={() => {
          setKeyword("");
          setSelectedIds(value.map((item) => item.id));
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("selectPropTitle")}</DialogTitle>
          <DialogDescription>{t("selectPropDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("searchPropName")}
          />

          <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
            {visibleItems.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 lg:grid-cols-4">
                {visibleItems.map((item) => {
                  const active = selectedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((current) =>
                          current.includes(item.id)
                            ? current.filter((value) => value !== item.id)
                            : [...current, item.id]
                        )
                      }
                      className={`overflow-hidden rounded-xl border-2 bg-muted/20 text-left transition-colors ${
                        active ? "border-primary" : "border-transparent hover:border-primary/30"
                      }`}
                    >
                      <div className="relative aspect-square overflow-hidden bg-muted">
                        {item.image ? (
                          <img
                            src={ossUrl(item.image)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground/40">
                            <IconPhoto className="size-6" />
                          </div>
                        )}
                        {active ? (
                          <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-white">
                            <IconCheck className="size-3.5" />
                          </div>
                        ) : null}
                      </div>
                      <div className="truncate px-2 py-2 text-center text-sm">
                        {item.name || tp("unnamedProp")}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {t("noProps")}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => {
                onConfirm(items.filter((item) => selectedIds.includes(item.id)));
                onOpenChange(false);
              }}
            >
              {tc("confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CharacterFusionDialog({
  open,
  onOpenChange,
  character,
  worldId,
  existingRoles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: FusionCharacter | null;
  worldId: string;
  existingRoles: ExistingRole[];
  onSaved?: () => void;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const { models: cachedModels } = useRawAiModels(AI_MODEL_PATHS.characterFusion);
  const models = cachedModels as RawAiModel[];
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(4);
  const [history, setHistory] = useState<FusionQueueItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [queue, setQueue] = useState<FusionQueueItem[]>([]);
  const [previewItem, setPreviewItem] = useState<FusionQueueItem | null>(null);
  const [fullPreviewUrl, setFullPreviewUrl] = useState("");
  const [roleName, setRoleName] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [activeCharacterImage, setActiveCharacterImage] = useState("");
  const [propOptions, setPropOptions] = useState<PropOption[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [selectedProps, setSelectedProps] = useState<PropOption[]>([]);
  const [propPickerOpen, setPropPickerOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");
  const processingRef = useRef(false);
  const queueRef = useRef<FusionQueueItem[]>([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const originalCharacterImage = useMemo(
    () => ossUrl(character?.roleImgPath?.[0]),
    [character?.roleImgPath]
  );
  const characterImage = activeCharacterImage || originalCharacterImage;
  const otherImgList = useMemo(() => {
    const raw = parseObjectSafely(character?.otherImgPath);
    return Object.entries(raw).map(([name, path]) => ({ name, path }));
  }, [character?.otherImgPath]);
  const allResults = useMemo(() => [...queue, ...history], [history, queue]);
  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: String(item.serviceName ?? item.serviceCode ?? ""),
        value: String(item.serviceCode ?? ""),
      })),
    [models]
  );
  const totalCost = useMemo(() => {
    const currentModel = models.find((item) => item.serviceCode === model);
    return Math.abs(Number(currentModel?.integralCost ?? 0)) * count;
  }, [count, model, models]);

  const loadHistory = useCallback(async () => {
    const roleId = String(character?.id ?? "");
    if (!roleId) {
      setHistory([]);
      return;
    }
    try {
      setHistoryLoading(true);
      const response = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/role/list", {
        data: { page: 1, pageSize: 50, roleId, type: "img", sort: 0 },
      });
      const items = (response?.list ?? []).map((item) => ({
        id: String(item.id ?? ""),
        url: ossUrl(item.path ?? item.storagePath ?? item.filePath ?? item.url) || "",
        storagePath: normalizeStoragePath(
          item.storagePath ?? item.path ?? item.filePath ?? item.url
        ),
        fromHistory: true,
      }));
      setHistory(items);
    } catch (error) {
      console.error("[CharacterFusionDialog] 加载历史失败:", error);
      toast.error(t("fusionHistoryFailed"));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [character?.id]);

  const loadFusionResources = useCallback(async () => {
    if (!open || !character?.id) return;
    try {
      setLoadingProps(true);
      const propsList = await loadAllProps(worldId);
      setPropOptions(propsList);
    } catch (error) {
      console.error("[CharacterFusionDialog] 初始化失败:", error);
      setPropOptions([]);
    } finally {
      setLoadingProps(false);
    }
  }, [character?.id, open, worldId]);

  useEffect(() => {
    if (!open) return;
    setPrompt(String(character?.prompt || character?.description || ""));
    setRoleName(String(character?.name || ""));
    setSelectedProps([]);
    setActiveCharacterImage("");
    setQueue([]);
    void Promise.all([loadFusionResources(), loadHistory()]);
  }, [
    character?.description,
    character?.id,
    character?.name,
    character?.prompt,
    loadFusionResources,
    loadHistory,
    open,
  ]);

  useEffect(() => {
    if (!open || models.length === 0 || model) return;
    setModel(findDefaultModel(models));
  }, [open, models, model]);

  useEffect(() => {
    if (!open) return;
    if (previewItem && allResults.some((item) => item.id === previewItem.id)) return;
    setPreviewItem(allResults[0] ?? null);
  }, [allResults, open, previewItem]);

  const processQueue = useCallback(() => {
    if (processingRef.current) return;
    const nextTask = queueRef.current.find((item) => item.status === "waiting" && item.params);
    if (!nextTask?.params) return;

    processingRef.current = true;
    setQueue((current) =>
      current.map((item) =>
        item.id === nextTask.id ? { ...item, status: "generating", error: undefined } : item
      )
    );

    void backendApi
      .post<string>("/api/ai/image/compose/character", {
        data: {
          worldRoleId: nextTask.params.worldRoleId,
          prompt: nextTask.params.prompt,
          model: nextTask.params.model || undefined,
          characterImageUrl: nextTask.params.characterImageUrl,
          propImageUrls: nextTask.params.propImageUrls,
          costumeImageUrls: [],
          styleText: "",
          styleImageUrl: "",
        },
        timeout: 360_000,
      })
      .then((result) => {
        const storagePath = normalizeStoragePath(String(result ?? ""));
        const nextItem: FusionQueueItem = {
          ...nextTask,
          status: "success",
          url: ossUrl(storagePath),
          storagePath,
          fromQueue: true,
        };
        setQueue((current) => current.map((item) => (item.id === nextTask.id ? nextItem : item)));
        setPreviewItem((current) => current ?? nextItem);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : t("fusionGenerateFailed");
        setQueue((current) =>
          current.map((item) =>
            item.id === nextTask.id ? { ...item, status: "failed", error: message } : item
          )
        );
      })
      .finally(() => {
        processingRef.current = false;
        queueMicrotask(processQueue);
      });
  }, []);

  const handleGenerate = useCallback(() => {
    const trimmedPrompt = prompt.trim();
    const roleId = Number(character?.id ?? 0);
    if (!trimmedPrompt) {
      toast.warning(t("enterPromptFirst"));
      return;
    }
    if (!roleId || !characterImage) {
      toast.warning(t("missingBaseImage"));
      return;
    }

    const propImageUrls = selectedProps.map((item) => ossUrl(item.image)).filter(Boolean);
    const nextTasks: FusionQueueItem[] = Array.from({ length: count }).map(() => ({
      id: `fusion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "waiting",
      fromQueue: true,
      params: {
        prompt: trimmedPrompt,
        model: model || undefined,
        worldRoleId: roleId,
        characterImageUrl: characterImage,
        propImageUrls,
      },
    }));

    setQueue((current) => [...nextTasks, ...current]);
    queueMicrotask(processQueue);
    toast.success(t("fusionTasksAdded", { count }));
  }, [character?.id, characterImage, count, model, processQueue, prompt, selectedProps]);

  const handleDelete = useCallback(
    async (item: FusionQueueItem) => {
      try {
        if (item.fromHistory && item.id) {
          await backendApi.post(`/api/ai/record/delete/${item.id}`);
          setHistory((current) => current.filter((historyItem) => historyItem.id !== item.id));
        } else {
          setQueue((current) => current.filter((queueItem) => queueItem.id !== item.id));
        }
        setPreviewItem((current) => (current?.id === item.id ? null : current));
      } catch (error) {
        console.error("[CharacterFusionDialog] 删除失败:", error);
        toast.error(tc("deleteFailed"));
      }
    },
    [tc]
  );

  const handleRetry = useCallback(
    (item: FusionQueueItem) => {
      setQueue((current) =>
        current.map((queueItem) =>
          queueItem.id === item.id
            ? { ...queueItem, status: "waiting", error: undefined }
            : queueItem
        )
      );
      queueMicrotask(processQueue);
    },
    [processQueue]
  );

  const performSelect = useCallback(async () => {
    const previewUrl = previewItem?.url ?? "";
    const previewPath = normalizeStoragePath(previewItem?.storagePath || previewUrl);
    if (!previewPath || !character?.id) return;

    setSelecting(true);
    try {
      await backendApi.post("/api/user/world/append/worldrole", {
        data: {
          id: character.id,
          name: roleName.trim(),
          imagePath: previewPath,
        },
      });
      toast.success(tc("saveSuccess"));
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error("[CharacterFusionDialog] 追加角色形象失败:", error);
      toast.error(tc("saveFailed"));
    } finally {
      setSelecting(false);
      setDuplicateName("");
    }
  }, [character?.id, onOpenChange, onSaved, previewItem, roleName]);

  const handleConfirmSelect = useCallback(() => {
    if (!previewItem) return;
    const name = roleName.trim();
    if (!name) {
      toast.warning(t("imageNamePlaceholder"));
      return;
    }
    const duplicated = existingRoles.some((role) =>
      Object.prototype.hasOwnProperty.call(parseObjectSafely(role.otherImgPath), name)
    );
    if (duplicated) {
      setDuplicateName(name);
      return;
    }
    void performSelect();
  }, [existingRoles, performSelect, previewItem, roleName]);

  const handleSetReference = useCallback(
    (item: FusionQueueItem) => {
      const nextUrl = item.url || "";
      if (!nextUrl) return;
      setActiveCharacterImage(nextUrl);
      toast.success(t("setAsBaseImage"));
    },
    [t]
  );

  const handlePreviewVariant = useCallback((name: string, path: string) => {
    const url = ossUrl(path);
    if (!url) return;
    setPreviewItem({
      id: `variant_${name}`,
      url,
      storagePath: normalizeStoragePath(path),
    });
  }, []);

  const loading = historyLoading || loadingProps;

  if (!character) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="w-[980px] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[980px]"
        >
          <DialogHeader className="border-b border-border px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle>{t("fusionTitle")}</DialogTitle>
                <DialogDescription>{t("fusionDescription")}</DialogDescription>
              </div>
              <Button
                variant="ghost"
                color="muted"
                size="icon-sm"
                onClick={() => onOpenChange(false)}
              >
                <IconX className="size-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="flex h-[720px] flex-col">
            <div className="flex flex-1 gap-2 overflow-hidden p-2">
              <div className="flex flex-[4] flex-col overflow-auto rounded-lg border border-dashed border-border/60">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ResultGallery
                    items={allResults}
                    loading={historyLoading}
                    previewItemId={previewItem?.id}
                    onPreview={(item) => setPreviewItem(item as FusionQueueItem)}
                    onDelete={(item) => void handleDelete(item as FusionQueueItem)}
                    onSetReference={(item) => handleSetReference(item as FusionQueueItem)}
                    onDownload={(item) => {
                      const url = item.url;
                      if (url) downloadUrl(url, "character-fusion.png");
                    }}
                    onRetry={(item) => handleRetry(item as FusionQueueItem)}
                    columns={3}
                    actions={["setReference", "download", "delete"]}
                  />
                )}
              </div>

              <div className="flex flex-[6] overflow-hidden rounded-lg border border-dashed border-border/60">
                <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-black">
                  {previewItem?.url ? (
                    <>
                      <img
                        src={previewItem.url}
                        alt=""
                        className="max-h-full max-w-full rounded-lg object-contain p-3"
                      />
                      <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
                        <IconButton
                          onClick={() => handleSetReference(previewItem)}
                          title={t("setAsBaseImageTitle")}
                          icon={<IconReplace className="size-4" />}
                        />
                        <IconButton
                          onClick={() =>
                            previewItem.url && downloadUrl(previewItem.url, "character-fusion.png")
                          }
                          title={tc("download")}
                          icon={<IconDownload className="size-4" />}
                        />
                        {previewItem.fromHistory || previewItem.fromQueue ? (
                          <IconButton
                            onClick={() => void handleDelete(previewItem)}
                            title={tc("delete")}
                            icon={<IconTrash className="size-4" />}
                          />
                        ) : null}
                        <IconButton
                          onClick={() => setFullPreviewUrl(previewItem.url || "")}
                          title={tc("viewFullImage")}
                          icon={<IconArrowsMaximize className="size-4" />}
                        />
                      </div>

                      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/70 px-4 py-3 backdrop-blur-sm">
                        <Input
                          value={roleName}
                          onChange={(event) => setRoleName(event.target.value)}
                          placeholder={t("imageNamePlaceholder")}
                          className="h-9 border-white/10 bg-white/5"
                        />
                        <Button
                          onClick={() => void handleConfirmSelect()}
                          disabled={!previewItem || selecting}
                        >
                          {selecting ? <IconLoader2 className="size-4 animate-spin" /> : null}
                          {t("saveImage")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
                      <IconPhoto className="size-8" />
                      <div className="text-sm">{t("clickToPreview")}</div>
                    </div>
                  )}
                </div>

                {otherImgList.length > 0 ? (
                  <div className="flex w-[128px] shrink-0 flex-col border-l border-border/60">
                    <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      {t("otherVariants")}
                    </div>
                    <div className="flex-1 overflow-auto p-2">
                      <div className="space-y-2">
                        {otherImgList.map((item) => (
                          <div
                            key={item.name}
                            className="group overflow-hidden rounded-lg border border-border/70 bg-muted/20"
                          >
                            <button
                              type="button"
                              onClick={() => handlePreviewVariant(item.name, item.path)}
                              className="block w-full"
                            >
                              <div className="relative aspect-square overflow-hidden">
                                <img
                                  src={ossUrl(item.path)}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    const nextUrl = ossUrl(item.path);
                                    if (!nextUrl) return;
                                    setActiveCharacterImage(nextUrl);
                                    toast.success(t("setAsBaseImage"));
                                  }}
                                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-primary group-hover:opacity-100"
                                  title={t("setAsBaseImageTitle")}
                                >
                                  <IconReplace className="size-3.5" />
                                </button>
                              </div>
                              <div className="truncate px-2 py-1.5 text-center text-[11px] text-muted-foreground">
                                {item.name}
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-border bg-[#1E1E24] p-3">
              <div className="rounded-xl border border-border/40 bg-[#1E1E24]">
                <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {characterImage ? (
                      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-white/[0.03] px-2 py-2">
                        <img
                          src={characterImage}
                          alt=""
                          className="size-12 rounded-md object-cover"
                        />
                        <span className="max-w-[140px] truncate text-xs text-foreground/85">
                          {character.name || t("baseImage")}
                        </span>
                      </div>
                    ) : null}

                    {selectedProps.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 rounded-full border border-border bg-white/[0.03] px-2 py-1"
                      >
                        {item.image ? (
                          <img
                            src={ossUrl(item.image)}
                            alt=""
                            className="size-6 rounded-full object-cover"
                          />
                        ) : null}
                        <span className="max-w-[100px] truncate text-xs">{item.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedProps((current) =>
                              current.filter((propItem) => propItem.id !== item.id)
                            )
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <IconX className="size-3.5" />
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setPropPickerOpen(true)}
                      className="flex h-12 items-center gap-1 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <IconPlus className="size-4" />
                      {t("selectProp")}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <IconWand className="size-3" />
                    <span>{t("enterEditMode")}</span>
                  </button>
                </div>

                <div className="px-4 py-3">
                  <Textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={t("fusionPromptPlaceholder")}
                    rows={4}
                    className="min-h-[120px] resize-none border-0 bg-transparent px-0 text-sm leading-relaxed shadow-none outline-none focus-visible:ring-0"
                  />
                </div>

                <div className="flex items-center justify-between rounded-b-xl bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <select
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        className="h-8 appearance-none rounded-lg bg-white/[0.04] pl-3 pr-7 text-[13px] text-white/85 outline-none transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08]"
                      >
                        {modelOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <IconCaret />
                    </div>

                    <div className="relative">
                      <select
                        value={String(count)}
                        onChange={(event) => setCount(Number(event.target.value))}
                        className="h-8 appearance-none rounded-lg bg-white/[0.04] pl-3 pr-7 text-[13px] text-white/85 outline-none transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08]"
                      >
                        <option value="1">1x</option>
                        <option value="2">2x</option>
                        <option value="4">4x</option>
                      </select>
                      <IconCaret />
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {totalCost > 0 ? (
                      <span className="flex h-7 min-w-[48px] items-center justify-center rounded-full text-xs font-medium text-white/80">
                        {totalCost}
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={!prompt.trim()}
                      className={`flex size-9 items-center justify-center rounded-full transition-all ${
                        prompt.trim()
                          ? "bg-primary text-white shadow-lg shadow-primary/30 hover:brightness-110"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {queue.some(
                        (item) => item.status === "waiting" || item.status === "generating"
                      ) ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconPlayerPlay className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PropPickerDialog
        open={propPickerOpen}
        onOpenChange={setPropPickerOpen}
        items={propOptions}
        value={selectedProps}
        onConfirm={setSelectedProps}
      />

      <AlertDialog
        open={Boolean(duplicateName)}
        onOpenChange={(nextOpen) => !nextOpen && setDuplicateName("")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("imageNameExists")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("imageNameExistsDesc", { name: duplicateName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void performSelect()} disabled={selecting}>
              {selecting ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {t("overwriteSave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MediaPreviewModal
        open={Boolean(fullPreviewUrl)}
        onOpenChange={(open) => !open && setFullPreviewUrl("")}
        type="image"
        src={fullPreviewUrl}
        name={t("fusionPreview")}
        link={fullPreviewUrl}
      />
    </>
  );
}

function IconButton({
  onClick,
  icon,
  title,
}: {
  onClick: () => void;
  icon: ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded text-white transition-colors hover:bg-white/10"
      title={title}
    >
      {icon}
    </button>
  );
}

function IconCaret() {
  return (
    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/50">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
