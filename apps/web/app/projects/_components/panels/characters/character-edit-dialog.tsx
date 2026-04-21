"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconLoader2,
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
import { backendApi } from "@/src/lib/api";
import type { RawAiModel, VoiceOptionItem } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { useAiModels, useRawAiModels } from "@/src/hooks/use-ai-models";
import { applySeedanceTemplate } from "@/src/lib/seedance";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
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
import {
  CharacterAiRecordPanel,
  type CharacterAiRecordPanelHandle,
} from "./character-ai-record-panel";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";

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
  const [formData, setFormData] = useState<CharacterFormState>(createEmptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [threeViewLoading, setThreeViewLoading] = useState(false);
  const { models: cachedVoiceModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const voiceModels = cachedVoiceModels as RawAiModel[];
  const { models: imageModels } = useAiModels("/api/ai/image/generate/basic");
  const [imageModelId, setImageModelId] = useState("");
  const selectedImageModel = useMemo(
    () => imageModels.find((model) => model.id === imageModelId),
    [imageModels, imageModelId]
  );
  const [voices, setVoices] = useState<Record<string, VoiceOptionItem[]>>({});
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const aiPanelRef = useRef<CharacterAiRecordPanelHandle | null>(null);

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

  // Voice models are now read from preloaded cache via useRawAiModels

  useEffect(() => {
    const modelCode = formData.voiceModelCode.trim();
    if (!open || !modelCode) {
      setVoices({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoadingVoices(true);
        const result = await backendApi.get<Record<string, VoiceOptionItem[]>>(
          "/api/ai/voice/voices/list",
          { params: { voiceType: modelCode } }
        );
        if (!cancelled) {
          setVoices(result ?? {});
        }
      } catch (error) {
        console.error("[CharacterEditDialog] 获取语音列表失败:", error);
        if (!cancelled) {
          setVoices({});
        }
      } finally {
        if (!cancelled) {
          setLoadingVoices(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formData.voiceModelCode, open]);

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
    const promptBase = (formData.prompt ?? "").trim();
    if (!promptBase) {
      toast.warning(tc("fillPromptFirst"));
      return;
    }
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
      toast.error(tc("threeViewFailed"));
    } finally {
      setThreeViewLoading(false);
    }
  }, [formData.id, formData.prompt, roleImagePath, t, tc]);

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
                  <div className="group relative aspect-9/14 h-48 overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                    {hasRoleImage ? (
                      <>
                        <img
                          src={roleImageUrl}
                          alt=""
                          className="h-full w-full cursor-zoom-in object-cover"
                          onClick={() => setPreviewImage(roleImageUrl)}
                        />
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
                      <div className="flex h-full items-center justify-center text-xs text-center text-muted-foreground/60">
                        从右侧「AI 生图」中选一张
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
                    <div className="text-[11px] text-muted-foreground/80">全局提示图</div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      color="muted"
                      onClick={() => void handleGenerateThreeView()}
                      disabled={threeViewLoading || !formData.prompt?.trim()}
                    >
                      {threeViewLoading ? (
                        <IconLoader2 className="size-3 animate-spin" />
                      ) : (
                        <IconWand className="size-3" />
                      )}
                      生成全局提示图
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
                        点右上「生成全局提示图」
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
                    maxLength={300}
                    rows={5}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel>{t("voiceModel")}</FieldLabel>
                    <Select
                      value={formData.voiceModelCode || "__none__"}
                      onValueChange={(value) =>
                        updateForm({
                          voiceModelCode: value === "__none__" ? "" : value,
                          voiceId: value === "__none__" ? "" : formData.voiceId,
                        })
                      }
                    >
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder={t("voiceModelPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent position="popper" className="max-h-60">
                        <SelectItem value="__none__">{t("noVoiceModel")}</SelectItem>
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
                      <CharacterAiRecordPanel
                        ref={aiPanelRef}
                        characterId={formData.id}
                        prompt={formData.prompt || formData.description}
                        model={imageModelId}
                        referenceImageUrl={formData.referenceImgPath[0] ?? roleImagePath}
                        selectedPath={roleImagePath}
                        onSelect={(path) =>
                          updateForm({ roleImgPath: [normalizeStoragePath(path)] })
                        }
                        onPreview={(url) => setPreviewImage(url)}
                      />
                    ) : (
                      <p className="rounded-md border border-dashed border-border/40 p-3 text-[11px] text-muted-foreground/60">
                        保存后才能生成 AI 角色图
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
                <div className="shrink-0 flex flex-col gap-2 rounded-xl border border-border/40 bg-muted p-4 transition-colors focus-within:border-primary/30">
                  <Textarea
                    value={formData.prompt}
                    onChange={(event) => updateForm({ prompt: event.target.value })}
                    placeholder={tc("promptPlaceholder")}
                    // 1000 instead of 500 — the Seedance template alone is
                    // ~200 chars and gets appended to whatever base prompt
                    // the user already has. 500 would silently clip the tail.
                    maxLength={1000}
                    rows={3}
                    className="min-h-0 resize-none border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
                  />
                  <div className="flex items-center justify-between">
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
                    </div>
                    <GenerateButton
                      onClick={() => aiPanelRef.current?.generate()}
                      cost={selectedImageModel?.cost}
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
        onSelect={(voice) => updateForm({ voiceId: String(voice.voiceId ?? "") })}
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
