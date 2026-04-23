"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { IconDeviceFloppy, IconLoader2, IconTrash } from "@tabler/icons-react";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldError, FieldGroup } from "@/components/ui/field";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
import { ToolbarSelect } from "@/components/ui/schema-field/toolbar-select";
import { GenerateButton } from "@/components/ui/generate-button";
import { backendApi } from "@/src/lib/api";
import { toast } from "sonner";
import { useAiModels } from "@/src/hooks/use-ai-models";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { normalizeStoragePath } from "@/src/lib/asset-paths";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { ReferenceImageUploader } from "../reference-image-uploader";
import { SceneImageSection } from "./scene-image-section";
import { AssetAiRecordPanel, type AssetAiRecordPanelHandle } from "../asset-ai-record-panel";
import type { ScenePanelItem } from "./scene-utils";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  updateScene,
  addScene,
  removeScene,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";

const MAX_SCENE_IMAGES = 6;
const SCENE_COLUMN_KEY = "-3";

function useSceneSchema() {
  const t = useTranslations("scene");
  return useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t("sceneNameRequired"))
          .max(20, t("sceneNameMaxLength", { max: 20 })),
        description: z.string().max(300),
        prompt: z.string().max(500),
        sceneImgPath: z.array(z.string()),
        referenceImgPath: z.array(z.string()),
        panoramaImagePath: z.string(),
      }),
    [t]
  );
}

type SceneFormValues = z.infer<ReturnType<typeof useSceneSchema>>;

export function SceneEditDialog({
  open,
  onOpenChange,
  scene,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scene: ScenePanelItem;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("scene");
  const tc = useTranslations("common");
  const sceneSchema = useSceneSchema();
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const [deleting, setDeleting] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const aiPanelRef = useRef<AssetAiRecordPanelHandle | null>(null);

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

  // Default-select first model once the list loads.
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

  const form = useForm<SceneFormValues>({
    resolver: zodResolver(sceneSchema),
    defaultValues: {
      name: "",
      description: "",
      prompt: "",
      sceneImgPath: [],
      referenceImgPath: [],
      panoramaImagePath: "",
    },
  });

  useEffect(() => {
    if (!open || !scene) return;
    form.reset({
      name: scene.name ?? "",
      description: String(scene.description ?? ""),
      prompt: String(scene.prompt ?? ""),
      sceneImgPath: Array.isArray(scene.sceneImgPath) ? [...scene.sceneImgPath] : [],
      referenceImgPath: Array.isArray(scene.referenceImgPath) ? [...scene.referenceImgPath] : [],
      panoramaImagePath: String(scene.panoramaImagePath ?? ""),
    });
  }, [open, scene, form]);

  const sceneId = String(scene?.id ?? "");
  const sceneImages = form.watch("sceneImgPath");
  const promptValue = form.watch("prompt");
  const description = form.watch("description");
  const composerPrompt = promptValue || description;

  const onSubmit = async (values: SceneFormValues) => {
    if (!worldId) return;
    try {
      const data = { worldId, ...values };
      if (scene?.id) {
        await backendApi.post("/api/user/world/update/worldscene", {
          data: { ...data, id: scene.id },
        });
        store.dispatch(updateScene({ id: scene.id, data: values }));
      } else {
        // Java returns the new id as a bare string — matches
        // /create/worldprop and /create/worldrole. Reading .id off it
        // would be undefined and quietly skip the dispatch.
        const createdId = await backendApi.post<string>("/api/user/world/create/worldscene", {
          data,
        });
        if (createdId) {
          store.dispatch(addScene({ id: String(createdId), ...values } as Asset));
        }
      }
      toast.success(tc("saveSuccess"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("[EditScene] 保存失败:", err);
      toast.error(tc("saveFailed"));
    }
  };

  const handleDelete = async () => {
    if (!scene?.id) return;
    setDeleting(true);
    try {
      await backendApi.post(`/api/user/world/delete/worldscene?id=${scene.id}`);
      store.dispatch(removeScene(scene.id));
      toast.success(tc("deleteSuccess"));
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      console.error("[EditScene] 删除失败:", err);
      toast.error(tc("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  // Clicking a gallery thumbnail appends to sceneImgPath. Clicking an
  // already-committed path is a no-op so the user can re-click without
  // surprise; removals happen from the left-hand scene image section.
  const handleSelectFromGallery = (path: string) => {
    const normalized = normalizeStoragePath(path);
    const current = form.getValues("sceneImgPath");
    if (current.some((p) => normalizeStoragePath(p) === normalized)) return;
    if (current.length >= MAX_SCENE_IMAGES) {
      toast.warning(t("maxSceneImages", { max: MAX_SCENE_IMAGES }));
      return;
    }
    form.setValue("sceneImgPath", [...current, normalized], { shouldDirty: true });
    toast.success(t("addedAiImage"));
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* Same two-column bottom-sheet as CharacterEditDialog: left
            owns the committed visual stack (scene images row, panorama,
            identity, reference), right owns the AI generation loop
            (gallery + composer). Composer writes to `prompt`, which is
            shared across both halves. */}
        <SheetContent
          side="bottom"
          className="mx-auto h-[90vh] w-full max-w-[1080px] overflow-hidden p-0"
        >
          <SheetHeader>
            <SheetTitle>{t("editScene")}</SheetTitle>
          </SheetHeader>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="grid h-full grid-rows-[minmax(0,1fr)] gap-6 overflow-hidden p-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                {/* ─── Left: committed visual stack + identity + reference ─── */}
                <FieldGroup className="overflow-y-auto pr-1">
                  <Field>
                    <FieldLabel>{t("sceneImages")}</FieldLabel>
                    <SceneImageSection
                      sceneId={sceneId}
                      images={sceneImages}
                      prompt={composerPrompt}
                      panoramaImagePath={form.watch("panoramaImagePath") ?? ""}
                      onImagesChange={(v) =>
                        form.setValue("sceneImgPath", v, { shouldDirty: true })
                      }
                      onPanoramaChange={(v) =>
                        form.setValue("panoramaImagePath", v, { shouldDirty: true })
                      }
                    />
                  </Field>

                  <Controller
                    name="name"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name} required>
                          {t("sceneName")}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          aria-invalid={fieldState.invalid}
                          maxLength={20}
                          placeholder={t("sceneNamePlaceholder")}
                        />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />

                  <Controller
                    name="description"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>{t("sceneDescription")}</FieldLabel>
                        <Textarea
                          {...field}
                          id={field.name}
                          aria-invalid={fieldState.invalid}
                          maxLength={300}
                          rows={4}
                          placeholder={t("sceneDescriptionPlaceholder")}
                        />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />

                  <Field>
                    <FieldLabel>{t("referenceImages")}</FieldLabel>
                    <ReferenceImageUploader
                      paths={form.watch("referenceImgPath")}
                      onChange={(v) => form.setValue("referenceImgPath", v, { shouldDirty: true })}
                      addLabel={tc("addReferenceImage")}
                    />
                  </Field>
                </FieldGroup>

                {/* ─── Right: AI gallery (flex-1) + composer (pinned bottom) ─── */}
                <div className="flex min-h-0 flex-col gap-4">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="min-h-0 flex-1">
                      {sceneId ? (
                        <AssetAiRecordPanel
                          ref={aiPanelRef}
                          assetId={sceneId}
                          columnKey={SCENE_COLUMN_KEY}
                          prompt={composerPrompt}
                          model={imageModelId}
                          size={imageSize}
                          count={imageCount}
                          referenceImageUrl={form.watch("referenceImgPath")[0] ?? sceneImages[0]}
                          selectedPaths={sceneImages}
                          onSelect={handleSelectFromGallery}
                          onPreview={(path) => setPreviewImage(buildOssUrl(path))}
                        />
                      ) : (
                        <p className="rounded-md border border-dashed border-border/40 p-3 text-[11px] text-muted-foreground/60">
                          保存后才能生成 AI 场景图
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Composer — textarea + model picker + generate.
                      Prompt is bound through the form so the committed
                      scene saves whatever the user last typed here. */}
                  <Controller
                    name="prompt"
                    control={form.control}
                    render={({ field }) => (
                      <div className="shrink-0 flex flex-col gap-2 rounded-xl border border-border/40 bg-muted p-4 transition-colors focus-within:border-primary/30">
                        <Textarea
                          {...field}
                          placeholder={tc("promptPlaceholder")}
                          maxLength={500}
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
                              !sceneId || !composerPrompt.trim()
                                ? "pointer-events-none opacity-50"
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    )}
                  />
                </div>
              </div>
            </div>

            <SheetFooter>
              {scene?.id ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="soft"
                      color="destructive"
                      disabled={deleting}
                      className="mr-auto"
                    >
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
                      <AlertDialogTitle>删除场景</AlertDialogTitle>
                      <AlertDialogDescription>
                        确定要删除「{form.watch("name") || "未命名场景"}」吗？此操作无法撤销。
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
              ) : null}
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={() => onOpenChange(false)}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconDeviceFloppy className="size-4" />
                )}
                {tc("save")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <MediaPreviewModal
        open={Boolean(previewImage)}
        onOpenChange={(next) => !next && setPreviewImage("")}
        type="image"
        src={previewImage}
        name={t("sceneImagePreview")}
        link={previewImage}
      />
    </>
  );
}
