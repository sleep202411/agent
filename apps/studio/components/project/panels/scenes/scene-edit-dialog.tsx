"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { IconLoader2, IconTrash } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("editScene")}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <div className="flex-1 space-y-4 overflow-y-auto px-0.5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("sceneName")}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={20} placeholder={t("sceneNamePlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("sceneDescription")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        maxLength={300}
                        rows={4}
                        placeholder={t("sceneDescriptionPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tc("prompt")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        maxLength={500}
                        rows={3}
                        placeholder={tc("promptPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sceneImgPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("sceneImages")}</FormLabel>
                    <FormControl>
                      <SceneImageSection
                        sceneId={String(scene?.id ?? "")}
                        images={field.value}
                        prompt={form.watch("prompt") || form.watch("description") || ""}
                        panoramaImagePath={form.watch("panoramaImagePath") ?? ""}
                        onImagesChange={field.onChange}
                        onPanoramaChange={(v) => form.setValue("panoramaImagePath", v)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="referenceImgPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("referenceImages")}</FormLabel>
                    <FormControl>
                      <ReferenceImageUploader
                        paths={field.value}
                        onChange={field.onChange}
                        addLabel={tc("addReferenceImage")}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="soft"
                color="destructive"
                onClick={handleDelete}
                disabled={deleting}
                className="mr-auto"
                style={{ visibility: scene?.id ? "visible" : "hidden" }}
              >
                {deleting ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconTrash className="size-3.5" />
                )}
                {tc("delete")}
              </Button>
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={() => onOpenChange(false)}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <IconLoader2 className="size-3.5 animate-spin" />}
                {tc("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
