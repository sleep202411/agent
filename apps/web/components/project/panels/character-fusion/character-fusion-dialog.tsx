import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
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
import { ResultGallery } from "@/components/storyboard/ai-generator/result-gallery";
import { backendApi, type Paginated } from "@/src/lib/api";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import {
  parseObjectSafely,
  normalizeStoragePath,
} from "@/components/project/panels/characters/character-utils";
import type { RawAiModel } from "@/src/types/workspace";
import type { Asset } from "@/src/store/slices/projectSlice";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import { useFusionQueue, type FusionQueueItem } from "./use-fusion-queue";
import { PropPickerDialog, type PropOption } from "./prop-picker-dialog";
import { FusionPreviewPanel } from "./fusion-preview-panel";
import { FusionControlBar } from "./fusion-control-bar";

const PROP_PAGE_SIZE = 100;

export type FusionCharacter = {
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

interface CharacterFusionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: FusionCharacter | null;
  worldId: string;
  existingRoles: ExistingRole[];
  onSaved?: () => void;
}

export function CharacterFusionDialog({
  open,
  onOpenChange,
  character,
  worldId,
  existingRoles,
  onSaved,
}: CharacterFusionDialogProps) {
  const t = useTranslations("character");
  const tc = useTranslations("common");

  // AI models
  const { models: cachedModels } = useRawAiModels(AI_MODEL_PATHS.characterFusion);
  const models = cachedModels as RawAiModel[];
  const [model, setModel] = useState("");

  // Generation parameters
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(4);

  // Preview state
  const [previewItem, setPreviewItem] = useState<FusionQueueItem | null>(null);
  const [fullPreviewUrl, setFullPreviewUrl] = useState("");

  // Save state
  const [roleName, setRoleName] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");

  // Character image
  const [activeCharacterImage, setActiveCharacterImage] = useState("");

  // Props
  const [propOptions, setPropOptions] = useState<PropOption[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [selectedProps, setSelectedProps] = useState<PropOption[]>([]);
  const [propPickerOpen, setPropPickerOpen] = useState(false);

  // Queue hook
  const characterId = String(character?.id ?? "");
  const { allResults, historyLoading, isGenerating, loadHistory, enqueue, retry, remove } =
    useFusionQueue({ characterId });

  // Derived values
  const originalCharacterImage = useMemo(
    () => buildOssUrl(character?.roleImgPath?.[0]),
    [character?.roleImgPath]
  );
  const characterImage = activeCharacterImage || originalCharacterImage;

  const otherImgList = useMemo(() => {
    const raw = parseObjectSafely(character?.otherImgPath);
    return Object.entries(raw).map(([name, path]) => ({ name, path }));
  }, [character?.otherImgPath]);

  // Initialize on open
  useEffect(() => {
    if (!open) return;
    setPrompt(String(character?.prompt || character?.description || ""));
    setRoleName(String(character?.name || ""));
    setSelectedProps([]);
    setActiveCharacterImage("");
    void loadHistory();
    void loadProps();
  }, [open, character?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProps() {
    if (!character?.id) return;
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
  }

  // Default model selection
  useEffect(() => {
    if (!open || models.length === 0 || model) return;
    setModel(findDefaultModel(models));
  }, [open, models, model]);

  // Auto-select first result for preview
  useEffect(() => {
    if (!open) return;
    if (previewItem && allResults.some((item) => item.id === previewItem.id)) return;
    setPreviewItem(allResults[0] ?? null);
  }, [allResults, open, previewItem]);

  // Handlers
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

    const propImageUrls = selectedProps.map((item) => buildOssUrl(item.image)).filter(Boolean);
    const inputs = Array.from({ length: count }).map(() => ({
      prompt: trimmedPrompt,
      model: model || undefined,
      worldRoleId: roleId,
      characterImageUrl: characterImage,
      propImageUrls,
    }));

    enqueue(inputs);
    toast.success(t("fusionTasksAdded", { count }));
  }, [character?.id, characterImage, count, enqueue, model, prompt, selectedProps, t]);

  const handleDelete = useCallback(
    async (item: FusionQueueItem) => {
      try {
        await remove(item);
        setPreviewItem((current) => (current?.id === item.id ? null : current));
      } catch (error) {
        console.error("[CharacterFusionDialog] 删除失败:", error);
        toast.error(tc("deleteFailed"));
      }
    },
    [remove, tc]
  );

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
    const url = buildOssUrl(path);
    if (!url) return;
    setPreviewItem({
      id: `variant_${name}`,
      url,
      storagePath: normalizeStoragePath(path),
    });
  }, []);

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
  }, [character?.id, onOpenChange, onSaved, previewItem, roleName, tc]);

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
  }, [existingRoles, performSelect, previewItem, roleName, t]);

  const loading = historyLoading || loadingProps;

  if (!character) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[980px] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[980px]">
          <DialogHeader>
            <DialogTitle>{t("fusionTitle")}</DialogTitle>
            <DialogDescription>{t("fusionDescription")}</DialogDescription>
          </DialogHeader>

          <div className="flex h-[720px] flex-col">
            {/* Main content: gallery + preview */}
            <div className="flex flex-1 gap-2 overflow-hidden p-2">
              {/* Left: result gallery */}
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
                      if (!item.url) return;
                      const anchor = document.createElement("a");
                      anchor.href = item.url;
                      anchor.download = "character-fusion.png";
                      anchor.click();
                    }}
                    onRetry={(item) => retry(item as FusionQueueItem)}
                    columns={3}
                    actions={["setReference", "download", "delete"]}
                  />
                )}
              </div>

              {/* Right: preview + variants */}
              <FusionPreviewPanel
                previewItem={previewItem}
                roleName={roleName}
                onRoleNameChange={setRoleName}
                onSetReference={handleSetReference}
                onDelete={handleDelete}
                onSave={handleConfirmSelect}
                onFullPreview={setFullPreviewUrl}
                saving={selecting}
                otherImgList={otherImgList}
                onPreviewVariant={handlePreviewVariant}
                onSetVariantAsBase={setActiveCharacterImage}
              />
            </div>

            {/* Bottom: control bar */}
            <FusionControlBar
              characterName={character.name || ""}
              characterImage={characterImage}
              prompt={prompt}
              onPromptChange={setPrompt}
              model={model}
              onModelChange={setModel}
              count={count}
              onCountChange={setCount}
              models={models}
              selectedProps={selectedProps}
              onRemoveProp={(id) =>
                setSelectedProps((current) => current.filter((item) => item.id !== id))
              }
              onOpenPropPicker={() => setPropPickerOpen(true)}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Prop picker */}
      <PropPickerDialog
        open={propPickerOpen}
        onOpenChange={setPropPickerOpen}
        items={propOptions}
        value={selectedProps}
        onConfirm={setSelectedProps}
      />

      {/* Duplicate name confirmation */}
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

      {/* Full image preview */}
      <MediaPreviewModal
        open={Boolean(fullPreviewUrl)}
        onOpenChange={(nextOpen) => !nextOpen && setFullPreviewUrl("")}
        type="image"
        src={fullPreviewUrl}
        name={t("fusionPreview")}
        link={fullPreviewUrl}
      />
    </>
  );
}
