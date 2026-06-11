"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconLanguage,
  IconLoader2,
  IconPhoto,
  IconTrash,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi, ApiRequestError } from "@/src/lib/api";
import type { RawAiModel, VoiceOptionItem } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { useAiModels, useRawAiModels } from "@/src/hooks/use-ai-models";
import { applySeedanceTemplate } from "@/src/lib/seedance";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
import { ToolbarSelect } from "@/components/ui/schema-field/toolbar-select";
import { GenerateButton } from "@/components/ui/generate-button";
import {
  normalizeStoragePath,
  parseObjectSafely,
  ROLE_THREE_VIEW_COLUMN_ID,
  type CharacterFormState,
  type CharacterPanelItem,
} from "./character-utils";
import { CharacterReferenceUploader } from "./character-reference-uploader";
import { VoicePickerDialog } from "./character-voice-picker";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { AssetAiRecordPanel, type AssetAiRecordPanelHandle } from "../asset-ai-record-panel";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  detectPromptLanguage,
  translateVideoPrompt,
} from "../../storyboard/ai-generator/video-dialog/expand-video-prompt";

/** Sentinel `voiceModelCode` for the "Custom" voice mode: the picker lists the
 *  user's OWN voices (Java `myvoices/list`) with an upload entry, instead of a
 *  model's public voices. Picking one resolves the saved model from the voice's
 *  own `model` field (custom voices are `minimax`). */
const CUSTOM_VOICE_MODE = "custom";

function createEmptyForm(): CharacterFormState {
  return {
    id: "",
    aiId: "",
    name: "",
    description: "",
    prompt: "",
    voiceModelCode: "",
    voiceId: "",
    roleImgPath: [],
    otherImgPath: {},
    referenceImgPath: [],
    referenceImgDescription: [],
    threeViewsImagePath: "",
  };
}

function buildFormState(character: CharacterPanelItem | null): CharacterFormState {
  if (!character) return createEmptyForm();
  return {
    id: String(character.id ?? ""),
    aiId: String(character.aiId ?? ""),
    name: String(character.name ?? ""),
    description: String(character.description ?? ""),
    prompt: String(character.prompt ?? ""),
    voiceModelCode: String(character.model ?? ""),
    voiceId: String(character.voiceId ?? ""),
    roleImgPath: character.roleImgPath?.length ? [character.roleImgPath[0]] : [],
    otherImgPath: { ...parseObjectSafely(character.otherImgPath) },
    referenceImgPath: [...(character.referenceImgPath ?? [])],
    referenceImgDescription: [...(character.referenceImgDescription ?? [])],
    threeViewsImagePath: String(character.threeViewsImagePath ?? ""),
  };
}

export function CharacterEditDialog({
  open,
  onOpenChange,
  worldId,
  character,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldId: string;
  character: CharacterPanelItem | null;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const ts = useTranslations("storyboard");
  const [formData, setFormData] = useState<CharacterFormState>(createEmptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [threeViewLoading, setThreeViewLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const { models: cachedVoiceModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const voiceModels = cachedVoiceModels as RawAiModel[];
  const { models: imageModels } = useAiModels("/api/ai/image/generate/basic");
  const [imageModelId, setImageModelId] = useState("");
  const [imageSize, setImageSize] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const selectedImageModel = useMemo(
    () => imageModels.find((model) => model.id === imageModelId),
    [imageModels, imageModelId]
  );
  const sizeField = selectedImageModel?.inputSchema?.properties?.size;
  const sizeOptions = useMemo(() => {
    if (!sizeField?.enum) return [];
    const labels = sizeField["x-enum-labels"] ?? {};
    return sizeField.enum.map((v) => ({
      label: labels[String(v)] ?? String(v),
      value: String(v),
    }));
  }, [sizeField]);
  const imageCost = (selectedImageModel?.cost ?? 0) * (imageCount || 1);
  const [voices, setVoices] = useState<Record<string, VoiceOptionItem[]>>({});
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  // Asset library picker for the role portrait — alternative entry
  // point alongside the right-side AI generator. Closed by default;
  // the empty-state placeholder and a "Replace" button on the
  // populated state both flip this open.
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const aiPanelRef = useRef<AssetAiRecordPanelHandle | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormData(buildFormState(character));
  }, [character, open]);

  // Default-select first model (preferring isDefault) once the image-model
  // list loads. Users can still switch via the composer's ModelPicker.
  useEffect(() => {
    if (imageModels.length === 0) return;
    if (imageModels.some((model) => model.id === imageModelId)) return;
    const preferred = imageModels.find((model) => model.isDefault) ?? imageModels[0];
    if (preferred) setImageModelId(preferred.id);
  }, [imageModels, imageModelId]);

  // Reset size to the model's default whenever the selected model changes or
  // the current size isn't in the new model's enum.
  useEffect(() => {
    if (!selectedImageModel) return;
    const enumValues = sizeField?.enum?.map(String) ?? [];
    if (imageSize && enumValues.includes(imageSize)) return;
    const next = sizeField?.default != null ? String(sizeField.default) : (enumValues[0] ?? "");
    if (next !== imageSize) setImageSize(next);
  }, [selectedImageModel, sizeField, imageSize]);

  // Voice models are now read from preloaded cache via useRawAiModels

  // Fetch the voice list for whatever model code is currently selected.
  // CUSTOM_VOICE_MODE → the user's own voices (myvoices/list, a flat list with
  // an upload entry); a specific serviceCode → that model's public voices
  // (voices/list, grouped by language). Returns the result so callers (e.g. the
  // post-upload refresh) can locate a freshly-added voice to auto-select.
  const fetchVoices = useCallback(async (): Promise<Record<string, VoiceOptionItem[]>> => {
    const modelCode = formData.voiceModelCode.trim();
    if (!modelCode) {
      setVoices({});
      return {};
    }
    try {
      setLoadingVoices(true);
      let next: Record<string, VoiceOptionItem[]> = {};
      if (modelCode === CUSTOM_VOICE_MODE) {
        // Custom mode: ONLY the user's own voices (myvoices/list, a flat list —
        // these do NOT appear in voices/list). Shown as a single custom list.
        const myList = await backendApi
          .get<VoiceOptionItem[]>("/api/ai/voice/myvoices/list")
          .catch(() => [] as VoiceOptionItem[]);
        if (Array.isArray(myList) && myList.length > 0) {
          next = { [t("myVoices")]: myList };
        }
      } else {
        // A specific model: that model's public voices, grouped by language.
        next =
          (await backendApi.get<Record<string, VoiceOptionItem[]>>("/api/ai/voice/voices/list", {
            params: { voiceType: modelCode },
          })) ?? {};
      }
      setVoices(next);
      return next;
    } catch (error) {
      console.error("[CharacterEditDialog] 获取语音列表失败:", error);
      setVoices({});
      return {};
    } finally {
      setLoadingVoices(false);
    }
  }, [formData.voiceModelCode, t]);

  useEffect(() => {
    if (!open) {
      setVoices({});
      return;
    }
    void fetchVoices();
  }, [fetchVoices, open]);

  const roleImagePath = formData.roleImgPath[0] ?? "";
  const roleImageUrl = buildOssUrl(roleImagePath);
  const hasRoleImage = Boolean(roleImagePath);
  const otherImages = useMemo(
    () => Object.entries(formData.otherImgPath).map(([name, path]) => ({ name, path })),
    [formData.otherImgPath]
  );
  const selectedVoiceName = useMemo(() => {
    for (const group of Object.values(voices)) {
      const matched = group.find((item) => String(item.voiceId ?? "") === formData.voiceId);
      if (matched) return String(matched.voiceName ?? matched.voiceId ?? "");
    }
    return formData.voiceId;
  }, [formData.voiceId, voices]);

  const updateForm = useCallback((updates: Partial<CharacterFormState>) => {
    setFormData((current) => ({ ...current, ...updates }));
  }, []);

  /**
   * "生成全局提示图" — replaces the old three-view-specific pipeline.
   * Combines the user's character prompt with the Seedance 2.0 template
   * preset and runs the standard `/api/ai/image/generate/basic` endpoint,
   * then stores the result in the threeViewsImagePath field (UI slot is
   * still called 三视图 for backwards compat; semantically now a global
   * reference image).
   */
  const handleGenerateThreeView = useCallback(async () => {
    if (!formData.id) {
      toast.warning(t("savePleaseFirst"));
      return;
    }
    // Empty prompt is allowed — the Seedance template provides the
    // baseline and a uploaded reference image alone can be enough.
    // Matches the behaviour of scene/prop edit dialogs (which never
    // had this gate).
    const promptBase = (formData.prompt ?? "").trim();
    const composedPrompt = applySeedanceTemplate(promptBase, "role");
    try {
      setThreeViewLoading(true);
      const result = await backendApi.post<string>("/api/ai/image/generate/basic", {
        data: {
          prompt: composedPrompt,
          shotColumnId: ROLE_THREE_VIEW_COLUMN_ID,
          shotId: formData.id,
          referenceImageUrl: roleImagePath ? buildOssUrl(roleImagePath) : undefined,
        },
        timeout: 360_000,
      });
      const nextPath = normalizeStoragePath(String(result ?? ""));
      if (!nextPath) {
        throw new Error(tc("noValidThreeView"));
      }
      setFormData((current) => ({ ...current, threeViewsImagePath: nextPath }));
      toast.success(tc("threeViewSuccess"));
    } catch (error) {
      console.error("[CharacterEditDialog] 生成全局提示图失败:", error);
      // Surface backend's `message` field when available — Java returns
      // useful business hints (quota / param / model-not-supported) that
      // a generic "failed" toast swallows.
      const apiMsg = error instanceof ApiRequestError ? error.message : null;
      const fallback = error instanceof Error ? error.message : null;
      toast.error(apiMsg || fallback || tc("threeViewFailed"));
    } finally {
      setThreeViewLoading(false);
    }
  }, [formData.id, formData.prompt, roleImagePath, t, tc]);

  const handleTranslatePrompt = useCallback(async () => {
    if (translating) return;
    const typed = (formData.prompt ?? "").trim();
    if (!typed) {
      toast.error(ts("translatePromptEmpty"));
      return;
    }
    setTranslating(true);
    try {
      const sourceLang = detectPromptLanguage(typed);
      const targetLang = sourceLang === "zh" ? "en" : "zh";
      const translated = await translateVideoPrompt({
        prompt: typed,
        sourceLang,
        targetLang,
      });
      setFormData((current) => ({ ...current, prompt: translated }));
      toast.success(
        ts(targetLang === "en" ? "translatePromptSuccessToEn" : "translatePromptSuccessToZh")
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${ts("translatePromptFailed")}: ${msg}`);
    } finally {
      setTranslating(false);
    }
  }, [formData.prompt, translating, ts]);

  const handleSave = useCallback(async () => {
    const trimmedName = formData.name.trim();
    if (!trimmedName || !worldId || saving) return;
    if (!formData.id) {
      throw new Error("[CharacterEditDialog] missing character id on save");
    }

    const submitData = {
      id: formData.id,
      aiId: formData.aiId || undefined,
      name: trimmedName,
      description: formData.description || "",
      prompt: formData.prompt || "",
      aiPrompt: formData.prompt || "",
      ai_prompt: formData.prompt || "",
      imagePromptPortrait: formData.prompt || "",
      image_prompt_portrait: formData.prompt || "",
      promptPortrait: formData.prompt || "",
      prompt_portrait: formData.prompt || "",
      model: formData.voiceModelCode || "",
      voiceId: formData.voiceId || "",
      roleImgPath: formData.roleImgPath,
      otherImgPath: formData.otherImgPath || {},
      referenceImgPath: formData.referenceImgPath || [],
      referenceImgDescription: formData.referenceImgDescription || [],
      threeViewsImagePath: formData.threeViewsImagePath || "",
      worldId,
    };

    try {
      setSaving(true);
      await backendApi.post("/api/user/world/update/worldrole", { data: submitData });
      toast.success(t("updateSuccess"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      console.error("[CharacterEditDialog] 保存失败:", error);
      toast.error(t("updateFailed"));
    } finally {
      setSaving(false);
    }
  }, [formData, onOpenChange, onSaved, saving, t, worldId]);

  const handleDelete = useCallback(async () => {
    if (!formData.id || deleting) return;
    try {
      setDeleting(true);
      await backendApi.post(`/api/user/world/delete/worldrole?id=${formData.id}`);
      toast.success(t("deleteSuccess"));
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      console.error("[CharacterEditDialog] 删除失败:", error);
      toast.error(t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }, [deleting, formData.id, onDeleted, onOpenChange]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* Bottom sheet. Wider than a standard dialog so the portrait
            gallery on the right gets room to breathe — the left column
            only needs to fit labelled form controls, so it's fixed at a
            narrow band while the right takes the remainder. Max-h 90vh
            leaves room for the mask. */}
        <SheetContent
          side="bottom"
          className="mx-auto h-[90vh] w-full max-w-[1080px] overflow-hidden p-0"
        >
          <SheetHeader>
            <SheetTitle>{t("editCharacter")}</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            {/* Two-column split. Left = identity (name / biography),
                voice, reference images, and the 全局提示图 preview —
                things the user fills in once and rarely touches after;
                scrolls independently if the form is taller than the
                sheet. Right = the portrait gallery + composer, which is
                the iterative loop: tweak prompt → hit 生成 → pick a
                result. Right column is non-scrolling: gallery flexes,
                composer is pinned to the bottom so it's always in
                reach. The shared prompt lives in formData.prompt and is
                also consumed by the left-hand "生成全局提示图" trigger. */}
            <div className="grid h-full grid-rows-[minmax(0,1fr)] gap-6 overflow-hidden p-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
              {/* ─── Left column: portrait → global ref → identity → voice → refs ─── */}
              <FieldGroup className="overflow-y-auto pr-1">
                {/* Current portrait — the selected item from the right
                    column's gallery is mirrored here at a larger size
                    so the user can see the face-level detail of their
                    active choice while authoring prompt / biography on
                    the same column. */}
                <div>
                  <div className="mb-2 text-[11px] text-muted-foreground/80">
                    {t("characterImageLabel")}
                  </div>
                  <div
                    className={cn(
                      "group relative h-48 overflow-hidden rounded-lg border border-dashed border-border bg-muted/20",
                      // With an image: width auto-fits the picture's natural
                      // aspect at h-48. Empty state keeps a portrait-ish
                      // box so the placeholder copy fits.
                      hasRoleImage ? "w-fit" : "aspect-9/14"
                    )}
                  >
                    {hasRoleImage ? (
                      <>
                        <img
                          src={roleImageUrl}
                          alt=""
                          className="h-full w-auto cursor-zoom-in"
                          onClick={() => setPreviewImage(roleImageUrl)}
                        />
                        {/* Hover-revealed "Replace from assets" affordance —
                            symmetric with the trash button so users can
                            either remove + regenerate or swap in one click. */}
                        <button
                          type="button"
                          onClick={() => setAssetPickerOpen(true)}
                          className="absolute right-10 top-2 flex size-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-foreground/30 group-hover:opacity-100"
                          title={t("pickFromAssets")}
                        >
                          <IconPhoto className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateForm({ roleImgPath: [] })}
                          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                          title={tc("delete")}
                        >
                          <IconX className="size-3" />
                        </button>
                      </>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-muted-foreground/60">
                        <span>{t("pickFromAiGenerate")}</span>
                        <span className="text-muted-foreground/40">{tc("or")}</span>
                        <Button
                          type="button"
                          variant="outline"
                          color="muted"
                          size="xs"
                          onClick={() => setAssetPickerOpen(true)}
                          className="h-7 gap-1.5"
                        >
                          <IconPhoto className="size-3" />
                          {t("pickFromAssets")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Global reference (三视图 slot) — its generator uses
                    `formData.prompt` which lives in the right column's
                    composer. The image is shown here on the left
                    because it's a single static reference separate from
                    the rotating portrait list. */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground/80">
                      {t("globalReference")}
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      color="muted"
                      onClick={() => void handleGenerateThreeView()}
                      disabled={threeViewLoading}
                    >
                      {threeViewLoading ? (
                        <IconLoader2 className="size-3 animate-spin" />
                      ) : (
                        <IconWand className="size-3" />
                      )}
                      {t("generateGlobalReference")}
                    </Button>
                  </div>
                  <div className="group relative h-[160px] overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                    {formData.threeViewsImagePath ? (
                      <>
                        <img
                          src={buildOssUrl(formData.threeViewsImagePath)}
                          alt=""
                          className="h-full w-full cursor-zoom-in object-cover"
                          onClick={() => setPreviewImage(buildOssUrl(formData.threeViewsImagePath))}
                        />
                        {threeViewLoading ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                            <IconLoader2 className="size-5 animate-spin text-white" />
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => updateForm({ threeViewsImagePath: "" })}
                          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                          title={tc("delete")}
                        >
                          <IconX className="size-3" />
                        </button>
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                        {t("clickGenerateGlobalReference")}
                      </div>
                    )}
                  </div>
                </div>

                <Field>
                  <FieldLabel required>{t("characterName")}</FieldLabel>
                  <Input
                    value={formData.name}
                    onChange={(event) => updateForm({ name: event.target.value })}
                    placeholder={t("characterNamePlaceholder")}
                    maxLength={20}
                  />
                </Field>

                <Field>
                  <FieldLabel required>{t("biography")}</FieldLabel>
                  <Textarea
                    value={formData.description}
                    onChange={(event) => updateForm({ description: event.target.value })}
                    placeholder={t("characterDescriptionPlaceholder")}
                    rows={5}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel>{t("voiceModel")}</FieldLabel>
                    <Select
                      value={formData.voiceModelCode || "__none__"}
                      onValueChange={(value) =>
                        // Switching the voice model clears the picked voice (the
                        // new model has a different voice list) — the effect then
                        // re-fetches that model's voices.
                        updateForm({
                          voiceModelCode: value === "__none__" ? "" : value,
                          voiceId: "",
                        })
                      }
                    >
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder={t("voiceModelPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent position="popper" className="max-h-60">
                        <SelectItem value="__none__">{t("noVoiceModel")}</SelectItem>
                        <SelectItem value={CUSTOM_VOICE_MODE}>{t("customVoiceMode")}</SelectItem>
                        {voiceModels.map((item) => {
                          const value = String(item.serviceCode ?? "");
                          if (!value) return null;
                          return (
                            <SelectItem key={value} value={value}>
                              {item.serviceName || value}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>{t("voice")}</FieldLabel>
                    <button
                      type="button"
                      disabled={!formData.voiceModelCode}
                      onClick={() => setVoicePickerOpen(true)}
                      className={cn(
                        "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        formData.voiceId ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span className="truncate">
                        {selectedVoiceName && formData.voiceModelCode
                          ? selectedVoiceName
                          : t("voicePlaceholder")}
                      </span>
                      <IconChevronDown className="size-4 shrink-0 opacity-50" />
                    </button>
                  </Field>
                </div>

                <Field>
                  <FieldLabel>{t("referenceImageDesc")}</FieldLabel>
                  <CharacterReferenceUploader
                    paths={formData.referenceImgPath}
                    descriptions={formData.referenceImgDescription}
                    onChange={(nextPaths, nextDescriptions) =>
                      updateForm({
                        referenceImgPath: nextPaths,
                        referenceImgDescription: nextDescriptions,
                      })
                    }
                  />
                </Field>
              </FieldGroup>

              {/* ─── Right column: portrait list on top, composer pinned at bottom ─── */}
              <div className="flex min-h-0 flex-col gap-4">
                {/* Gallery takes the free space so the composer below
                    hugs the bottom; min-h-0 is required on the flex
                    parent for the inner overflow-y-auto to work. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1">
                    {formData.id ? (
                      <AssetAiRecordPanel
                        ref={aiPanelRef}
                        assetId={formData.id}
                        columnKey="-1"
                        prompt={formData.prompt || formData.description}
                        model={imageModelId}
                        size={imageSize}
                        count={imageCount}
                        referenceImageUrl={formData.referenceImgPath[0] ?? roleImagePath}
                        selectedPaths={roleImagePath ? [roleImagePath] : undefined}
                        onSelect={(path) =>
                          updateForm({ roleImgPath: [normalizeStoragePath(path)] })
                        }
                        onPreview={(path) => setPreviewImage(buildOssUrl(path))}
                      />
                    ) : (
                      <p className="rounded-md border border-dashed border-border/40 p-3 text-[11px] text-muted-foreground/60">
                        {t("saveFirstToEnableAiGen")}
                      </p>
                    )}
                  </div>
                </div>

                {otherImages.length > 0 ? (
                  <div className="shrink-0">
                    <div className="mb-2 text-[11px] text-muted-foreground/80">
                      {t("otherImages")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {otherImages.map((item) => (
                        <div key={item.name} className="group relative overflow-hidden rounded-md">
                          <img
                            src={buildOssUrl(item.path)}
                            alt=""
                            className="size-[80px] cursor-zoom-in rounded-md object-cover"
                            onClick={() => setPreviewImage(buildOssUrl(item.path))}
                          />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[10px] text-white">
                            {item.name}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const nextImages = { ...formData.otherImgPath };
                              delete nextImages[item.name];
                              updateForm({ otherImgPath: nextImages });
                            }}
                            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-primary group-hover:opacity-100"
                          >
                            <IconX className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Composer — mirrors the storyboard AI image dialog's
                    PromptInput: rounded-xl muted container, focus ring
                    accent, textarea on top, bottom toolbar with model
                    picker on the left and GenerateButton on the right.
                    Pinned to the bottom of the right column via flex
                    ordering. Writing to formData.prompt is shared with
                    the 全局提示图 generator on the left. */}
                <div className="shrink-0 flex flex-col gap-2 rounded-xl border border-border/40 bg-muted transition-colors focus-within:border-primary/30">
                  <div className="relative">
                    <Textarea
                      value={formData.prompt}
                      onChange={(event) => updateForm({ prompt: event.target.value })}
                      placeholder={tc("promptPlaceholder")}
                      // 1000 instead of 500 — the Seedance template alone is
                      // ~200 chars and gets appended to whatever base prompt
                      // the user already has. 500 would silently clip the tail.
                      maxLength={1000}
                      rows={6}
                      className="h-32 p-4 pr-24 resize-none border-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
                    />
                    <button
                      type="button"
                      onClick={() => void handleTranslatePrompt()}
                      disabled={translating || !formData.prompt?.trim()}
                      title={ts("translatePromptTooltip")}
                      className="absolute right-2 top-2 inline-flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {translating ? (
                        <IconLoader2 className="size-3 animate-spin" />
                      ) : (
                        <IconLanguage className="size-3" />
                      )}
                      {ts("translatePromptButton")}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-2">
                      <ModelPicker
                        models={imageModels}
                        value={imageModelId}
                        onChange={setImageModelId}
                        compact
                        // Override the default translucent glass — the
                        // portrait gallery behind the popover has bright
                        // highlights that bleed through `bg-white/6` and
                        // render the list text unreadable. Solid popover
                        // background keeps contrast high.
                        contentClassName="bg-popover backdrop-blur-none backdrop-saturate-100 border-border"
                      />
                      {sizeOptions.length > 0 ? (
                        <ToolbarSelect
                          options={sizeOptions}
                          value={imageSize}
                          onChange={setImageSize}
                        />
                      ) : null}
                      <ToolbarSelect
                        options={[
                          { label: "1x", value: "1" },
                          { label: "2x", value: "2" },
                          { label: "4x", value: "4" },
                        ]}
                        value={String(imageCount)}
                        onChange={(v) => setImageCount(Number(v) || 1)}
                      />
                    </div>
                    <GenerateButton
                      onClick={() => aiPanelRef.current?.generate()}
                      cost={imageCost}
                      className={
                        !formData.id || !formData.prompt?.trim()
                          ? "pointer-events-none opacity-50"
                          : undefined
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <SheetFooter>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="soft" color="destructive" className="mr-auto" disabled={deleting}>
                  {deleting ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : (
                    <IconTrash className="size-4" />
                  )}
                  {tc("delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除角色</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要删除「{formData.name || t("unnamedCharacter")}」吗？此操作无法撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction color="destructive" onClick={() => void handleDelete()}>
                    {tc("delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={!formData.name.trim() || saving}>
              {saving ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-4" />
              )}
              {tc("save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <VoicePickerDialog
        open={voicePickerOpen}
        onOpenChange={setVoicePickerOpen}
        voices={voices}
        loading={loadingVoices}
        selectedVoiceId={formData.voiceId}
        canAddCustomVoice={formData.voiceModelCode === CUSTOM_VOICE_MODE}
        onVoiceAdded={fetchVoices}
        onSelect={(voice) => updateForm({ voiceId: String(voice.voiceId ?? "") })}
      />

      {/* Role-portrait asset picker — shared by both the empty-state
          "from assets" button and the populated-state hover replace
          button. AssetPickerDialog returns paths via its `onSelect`
          callback; we normalise to a single-item array since
          `roleImgPath` is modeled as a list (legacy from a multi-image
          design that never shipped). */}
      <AssetPickerDialog
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        assetType="img"
        multiple={false}
        onSelect={(paths) => {
          const next = paths[0];
          if (next) updateForm({ roleImgPath: [normalizeStoragePath(next)] });
          setAssetPickerOpen(false);
        }}
      />

      <MediaPreviewModal
        open={Boolean(previewImage)}
        onOpenChange={(open) => !open && setPreviewImage("")}
        type="image"
        src={previewImage}
        name={t("characterImagePreview")}
        link={previewImage}
      />
    </>
  );
}
