"use client";

import { useEffect, useMemo, useState } from "react";
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
import { backendApi } from "@/src/lib/api";
import { toast } from "sonner";
import { ReferenceImageUploader } from "../reference-image-uploader";
import { SceneImageSection } from "./scene-image-section";
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
        const result = await backendApi.post<Asset>("/api/user/world/create/worldscene", {
          data,
        });
        if (result?.id) {
          store.dispatch(addScene({ ...result, ...values }));
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Bottom sheet — same shell as CharacterEditDialog. Left column
          owns text authoring (name / description / prompt), right
          column owns the visual stack (scene images → panorama →
          reference). Multi-image rows scroll horizontally so the
          overall layout stays inside one viewport height. */}
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
              {/* ─── Left: identity + prompt ─── */}
              <FieldGroup className="overflow-y-auto pr-1">
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
                        rows={5}
                        placeholder={t("sceneDescriptionPlaceholder")}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />

                <Controller
                  name="prompt"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>{tc("prompt")}</FieldLabel>
                      <Textarea
                        {...field}
                        id={field.name}
                        aria-invalid={fieldState.invalid}
                        maxLength={500}
                        rows={4}
                        placeholder={tc("promptPlaceholder")}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </FieldGroup>

              {/* ─── Right: scene images + panorama + reference ─── */}
              <div className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
                <Field>
                  <FieldLabel>{t("sceneImages")}</FieldLabel>
                  <SceneImageSection
                    sceneId={String(scene?.id ?? "")}
                    images={form.watch("sceneImgPath")}
                    prompt={form.watch("prompt") || form.watch("description") || ""}
                    panoramaImagePath={form.watch("panoramaImagePath") ?? ""}
                    onImagesChange={(v) => form.setValue("sceneImgPath", v)}
                    onPanoramaChange={(v) => form.setValue("panoramaImagePath", v)}
                  />
                </Field>

                <Field>
                  <FieldLabel>{t("referenceImages")}</FieldLabel>
                  <ReferenceImageUploader
                    paths={form.watch("referenceImgPath")}
                    onChange={(v) => form.setValue("referenceImgPath", v)}
                    addLabel={tc("addReferenceImage")}
                  />
                </Field>
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
  );
}
