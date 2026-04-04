"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconDeviceFloppy,
  IconLoader2,
  IconTrash,
  IconUpload,
  IconVolume,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { backendApi } from "@/src/lib/api";
import type { RawAiModel, VoiceOptionItem } from "@/src/types/workspace";
import { uploadProjectImage, buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import type { Asset } from "@/src/store/slices/projectSlice";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";
import {
  normalizeStoragePath,
  parseObjectSafely,
  ROLE_THREE_VIEW_COLUMN_ID,
  type CharacterFormState,
  type CharacterPanelItem,
} from "./character-utils";
import { CharacterReferenceUploader } from "./character-reference-uploader";
import { VoicePickerDialog } from "./character-voice-picker";
import { CharacterAiRecordDialog } from "./character-ai-record-dialog";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";

export function createEmptyForm(): CharacterFormState {
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

export function buildFormState(character: CharacterPanelItem | null): CharacterFormState {
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
  const [formData, setFormData] = useState<CharacterFormState>(createEmptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingRoleImage, setUploadingRoleImage] = useState(false);
  const [threeViewLoading, setThreeViewLoading] = useState(false);
  const { models: cachedVoiceModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const voiceModels = cachedVoiceModels as RawAiModel[];
  const [voices, setVoices] = useState<Record<string, VoiceOptionItem[]>>({});
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [aiRecordOpen, setAiRecordOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const roleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormData(buildFormState(character));
  }, [character, open]);

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

  const handleRoleImageUpload = useCallback(async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.warning("请选择图片文件");
      return;
    }
    try {
      setUploadingRoleImage(true);
      const uploadedPath = await uploadProjectImage(file);
      setFormData((current) => ({ ...current, roleImgPath: [uploadedPath] }));
      toast.success("上传成功");
    } catch (error) {
      console.error("[CharacterEditDialog] 上传角色图失败:", error);
      toast.error("上传失败");
    } finally {
      setUploadingRoleImage(false);
      if (roleInputRef.current) {
        roleInputRef.current.value = "";
      }
    }
  }, []);

  const handleGenerateThreeView = useCallback(async () => {
    if (!formData.id) {
      toast.warning("请先保存角色");
      return;
    }
    if (!roleImagePath) {
      toast.warning("请先上传角色图片");
      return;
    }
    try {
      setThreeViewLoading(true);
      const result = await backendApi.post<string>("/api/ai/image/generate/character-three-view", {
        data: {
          shotColumnId: ROLE_THREE_VIEW_COLUMN_ID,
          shotId: formData.id,
          characterImageUrl: buildOssUrl(roleImagePath),
          prompt: formData.prompt || undefined,
        },
        timeout: 360_000,
      });
      const nextPath = normalizeStoragePath(String(result ?? ""));
      if (!nextPath) {
        throw new Error("未生成三视图");
      }
      setFormData((current) => ({ ...current, threeViewsImagePath: nextPath }));
      toast.success("三视图生成成功");
    } catch (error) {
      console.error("[CharacterEditDialog] 生成三视图失败:", error);
      toast.error("三视图生成失败");
    } finally {
      setThreeViewLoading(false);
    }
  }, [formData.id, formData.prompt, roleImagePath]);

  const handleSave = useCallback(async () => {
    const trimmedName = formData.name.trim();
    if (!trimmedName || !worldId || saving) return;

    const submitData = {
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
      if (formData.id) {
        await backendApi.post("/api/user/world/update/worldrole", {
          data: { ...submitData, id: formData.id, aiId: formData.aiId || undefined },
        });
        toast.success("角色更新成功");
      } else {
        await backendApi.post<Asset>("/api/user/world/create/worldrole", {
          data: { ...submitData, aiId: formData.aiId || undefined },
        });
        toast.success("角色创建成功");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      console.error("[CharacterEditDialog] 保存失败:", error);
      toast.error(formData.id ? "角色更新失败" : "角色创建失败");
    } finally {
      setSaving(false);
    }
  }, [formData, onOpenChange, onSaved, saving, worldId]);

  const handleDelete = useCallback(async () => {
    if (!formData.id || deleting) return;
    try {
      setDeleting(true);
      await backendApi.post(`/api/user/world/delete/worldrole?id=${formData.id}`);
      toast.success("角色删除成功");
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      console.error("[CharacterEditDialog] 删除失败:", error);
      toast.error("角色删除失败");
    } finally {
      setDeleting(false);
    }
  }, [deleting, formData.id, onDeleted, onOpenChange]);

  return (
    <>
      <input
        ref={roleInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleRoleImageUpload(event.target.files?.[0] ?? undefined)}
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[85vh] overflow-hidden p-0 sm:max-w-[600px]"
        >
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{formData.id ? "编辑角色" : "创建角色"}</DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(85vh-140px)] overflow-y-auto px-6 py-5">
            <FieldGroup>
              <Field>
                <FieldLabel>角色名称</FieldLabel>
                <Input
                  value={formData.name}
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder="请输入角色名称"
                  maxLength={20}
                />
              </Field>

              <Field>
                <FieldLabel>人物小传</FieldLabel>
                <Textarea
                  value={formData.description}
                  onChange={(event) => updateForm({ description: event.target.value })}
                  placeholder="描述角色的背景、性格、特征等"
                  maxLength={300}
                  rows={5}
                />
              </Field>

              <Field>
                <FieldLabel>提示词</FieldLabel>
                <Textarea
                  value={formData.prompt}
                  onChange={(event) => updateForm({ prompt: event.target.value })}
                  placeholder="AI 生成图片时使用的提示词"
                  maxLength={500}
                  rows={3}
                />
              </Field>

              <Field>
                <FieldLabel>语音模型</FieldLabel>
                <div className="flex items-center gap-2">
                  <Select
                    value={formData.voiceModelCode || undefined}
                    onValueChange={(value) => updateForm({ voiceModelCode: value, voiceId: "" })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择语音模型" />
                    </SelectTrigger>
                    <SelectContent>
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
                  {formData.voiceModelCode ? (
                    <Button
                      type="button"
                      variant="outline"
                      color="muted"
                      size="sm"
                      onClick={() => updateForm({ voiceModelCode: "", voiceId: "" })}
                    >
                      清空
                    </Button>
                  ) : null}
                </div>
              </Field>

              {formData.voiceModelCode ? (
                <Field>
                  <FieldLabel>角色语音</FieldLabel>
                  <button
                    type="button"
                    onClick={() => setVoicePickerOpen(true)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input px-3 text-left text-sm transition-colors hover:border-white/20"
                  >
                    <span
                      className={selectedVoiceName ? "text-foreground" : "text-muted-foreground"}
                    >
                      {selectedVoiceName || "请选择角色语音"}
                    </span>
                    <IconVolume className="size-4 text-muted-foreground" />
                  </button>
                </Field>
              ) : null}

              <Field>
                <FieldLabel>角色图片</FieldLabel>
                <div className="flex gap-4">
                  <div className="w-[150px] shrink-0 space-y-2">
                    <div className="text-[11px] text-muted-foreground/80">角色形象</div>
                    <div className="group relative h-[200px] overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                      {hasRoleImage ? (
                        <>
                          <img src={roleImageUrl} alt="" className="h-full w-full object-cover" />
                          {uploadingRoleImage ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                              <IconLoader2 className="size-5 animate-spin text-white" />
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/70 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                size="sm"
                                variant="soft"
                                color="muted"
                                onClick={() => setPreviewImage(roleImageUrl)}
                              >
                                查看大图
                              </Button>
                              <Button
                                size="sm"
                                variant="soft"
                                color="muted"
                                onClick={() => roleInputRef.current?.click()}
                              >
                                <IconUpload className="size-3" />
                                上传图片
                              </Button>
                              <Button
                                size="sm"
                                variant="soft"
                                color="muted"
                                onClick={() => {
                                  if (!formData.id) {
                                    toast.warning("请先保存角色");
                                    return;
                                  }
                                  setAiRecordOpen(true);
                                }}
                              >
                                <IconWand className="size-3" />
                                AI 生图
                              </Button>
                              <Button
                                size="sm"
                                variant="soft"
                                color="destructive"
                                onClick={() => updateForm({ roleImgPath: [] })}
                              >
                                删除
                              </Button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="soft"
                            color="muted"
                            onClick={() => roleInputRef.current?.click()}
                          >
                            <IconUpload className="size-3" />
                            上传图片
                          </Button>
                          <Button
                            size="sm"
                            variant="soft"
                            color="muted"
                            onClick={() => {
                              if (!formData.id) {
                                toast.warning("请先保存角色");
                                return;
                              }
                              setAiRecordOpen(true);
                            }}
                          >
                            <IconWand className="size-3" />
                            AI 生图
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 space-y-2">
                    <div className="text-[11px] text-muted-foreground/80">三视图</div>
                    <div className="group relative h-[200px] overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                      {formData.threeViewsImagePath ? (
                        <>
                          <img
                            src={buildOssUrl(formData.threeViewsImagePath)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                          {threeViewLoading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                              <IconLoader2 className="size-5 animate-spin text-white" />
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/70 opacity-0 transition-opacity group-hover:opacity-100">
                              <div className="flex flex-col gap-1.5">
                                <Button
                                  size="sm"
                                  variant="soft"
                                  color="muted"
                                  onClick={() =>
                                    setPreviewImage(buildOssUrl(formData.threeViewsImagePath))
                                  }
                                >
                                  查看大图
                                </Button>
                                <Button
                                  size="sm"
                                  variant="soft"
                                  color="muted"
                                  onClick={() => void handleGenerateThreeView()}
                                >
                                  <IconWand className="size-3" />
                                  重新生成
                                </Button>
                                <Button
                                  size="sm"
                                  variant="soft"
                                  color="destructive"
                                  onClick={() => updateForm({ threeViewsImagePath: "" })}
                                >
                                  删除
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Button
                            size="sm"
                            variant="outline"
                            color="muted"
                            onClick={() => void handleGenerateThreeView()}
                            disabled={!hasRoleImage || threeViewLoading}
                          >
                            {threeViewLoading ? (
                              <IconLoader2 className="size-3 animate-spin" />
                            ) : null}
                            生成三视图
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Field>

              {otherImages.length > 0 ? (
                <Field>
                  <FieldLabel>其他形象图</FieldLabel>
                  <div className="flex flex-wrap gap-3">
                    {otherImages.map((item) => (
                      <div key={item.name} className="group relative overflow-hidden rounded-lg">
                        <img
                          src={buildOssUrl(item.path)}
                          alt=""
                          className="h-[100px] w-[100px] cursor-zoom-in rounded-lg object-cover"
                          onClick={() => setPreviewImage(buildOssUrl(item.path))}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-[11px] text-white">
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
                </Field>
              ) : null}

              <Field>
                <FieldLabel>参考图</FieldLabel>
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
          </div>

          <DialogFooter>
            {formData.id ? (
              <Button
                variant="soft"
                color="destructive"
                className="mr-auto"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconTrash className="size-4" />
                )}
                删除
              </Button>
            ) : null}
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} disabled={!formData.name.trim() || saving}>
              {saving ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDeviceFloppy className="size-4" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VoicePickerDialog
        open={voicePickerOpen}
        onOpenChange={setVoicePickerOpen}
        voices={voices}
        loading={loadingVoices}
        selectedVoiceId={formData.voiceId}
        onSelect={(voice) => updateForm({ voiceId: String(voice.voiceId ?? "") })}
      />

      <CharacterAiRecordDialog
        open={aiRecordOpen}
        onOpenChange={setAiRecordOpen}
        characterId={formData.id}
        prompt={formData.prompt || formData.description}
        referenceImageUrl={buildOssUrl(formData.referenceImgPath[0] ?? roleImagePath)}
        selectedPath={roleImagePath}
        onSelect={(path) => updateForm({ roleImgPath: [normalizeStoragePath(path)] })}
      />

      <MediaPreviewModal
        open={Boolean(previewImage)}
        onOpenChange={(open) => !open && setPreviewImage("")}
        type="image"
        src={previewImage}
        name="角色图片预览"
        link={previewImage}
      />
    </>
  );
}
