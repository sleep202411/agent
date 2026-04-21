"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconDeviceFloppy, IconLoader2, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
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
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
import { GenerateButton } from "@/components/ui/generate-button";
import { backendApi } from "@/src/lib/api";
import { useAiModels } from "@/src/hooks/use-ai-models";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { normalizeStoragePath } from "@/src/lib/asset-paths";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { ReferenceImageUploader } from "../reference-image-uploader";
import { PropImageSection } from "./prop-image-section";
import { AssetAiRecordPanel, type AssetAiRecordPanelHandle } from "../asset-ai-record-panel";
import type { PropPanelItem } from "./prop-utils";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  updateProp,
  addProp,
  removeProp,
  selectCurrentInstance,
  type Asset,
} from "@/src/store/slices/projectSlice";

const MAX_PROP_IMAGES = 6;
const PROP_COLUMN_KEY = "-2";

interface FormState {
  name: string;
  description: string;
  prompt: string;
  propImgPath: string[];
  referenceImgPath: string[];
  threeViewsImagePath: string;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  prompt: "",
  propImgPath: [],
  referenceImgPath: [],
  threeViewsImagePath: "",
};

export function PropEditDialog({
  open,
  onOpenChange,
  prop,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prop: PropPanelItem;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("prop");
  const tc = useTranslations("common");
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const aiPanelRef = useRef<AssetAiRecordPanelHandle | null>(null);

  const { models: imageModels } = useAiModels("/api/ai/image/generate/basic");
  const [imageModelId, setImageModelId] = useState("");
  const selectedImageModel = useMemo(
    () => imageModels.find((model) => model.id === imageModelId),
    [imageModels, imageModelId]
  );

  useEffect(() => {
    if (imageModels.length === 0) return;
    if (imageModels.some((model) => model.id === imageModelId)) return;
    const preferred = imageModels.find((model) => model.isDefault) ?? imageModels[0];
    if (preferred) setImageModelId(preferred.id);
  }, [imageModels, imageModelId]);

  useEffect(() => {
    if (!open || !prop) return;
    setErrors({});
    setForm({
      name: prop.name ?? "",
      description: String(prop.description ?? ""),
      prompt: String(prop.prompt ?? ""),
      propImgPath: Array.isArray(prop.propImgPath) ? [...prop.propImgPath] : [],
      referenceImgPath: Array.isArray(prop.referenceImgPath) ? [...prop.referenceImgPath] : [],
      threeViewsImagePath: String(prop.threeViewsImagePath ?? ""),
    });
  }, [open, prop]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = t("propNameRequired");
    if (form.name.length > 20) next.name = t("propNameMaxLength", { max: 20 });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!worldId || !validate()) return;
    setSaving(true);
    try {
      const data = { worldId, ...form };
      if (prop?.id) {
        await backendApi.post("/api/user/world/update/worldprop", {
          data: { ...data, id: prop.id },
        });
        store.dispatch(updateProp({ id: prop.id, data: { ...form } }));
      } else {
        const result = await backendApi.post<Asset>("/api/user/world/create/worldprop", { data });
        if (result?.id) {
          store.dispatch(addProp({ ...result, ...form }));
        }
      }
      toast.success(tc("saveSuccess"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("[EditProp] 保存失败:", err);
      toast.error(tc("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!prop?.id) return;
    setDeleting(true);
    try {
      await backendApi.post(`/api/user/world/delete/worldprop?id=${prop.id}`);
      store.dispatch(removeProp(prop.id));
      toast.success(tc("deleteSuccess"));
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      console.error("[EditProp] 删除失败:", err);
      toast.error(tc("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const propId = String(prop?.id ?? "");
  const composerPrompt = form.prompt || form.description;

  // Append to propImgPath. Already-committed paths are no-ops; removals
  // stay in the left-hand prop image section.
  const handleSelectFromGallery = (path: string) => {
    const normalized = normalizeStoragePath(path);
    if (form.propImgPath.some((p) => normalizeStoragePath(p) === normalized)) return;
    if (form.propImgPath.length >= MAX_PROP_IMAGES) {
      toast.warning(t("maxPropImages", { max: MAX_PROP_IMAGES }));
      return;
    }
    setField("propImgPath", [...form.propImgPath, normalized]);
    toast.success(t("addedAiImage"));
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* Same two-column bottom-sheet shell as Scene/Character:
            left = committed visual stack + identity + reference,
            right = AI gallery + composer (prompt + model + generate). */}
        <SheetContent
          side="bottom"
          className="mx-auto h-[90vh] w-full max-w-[1080px] overflow-hidden p-0"
        >
          <SheetHeader>
            <SheetTitle>{t("editProp")}</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="grid h-full grid-rows-[minmax(0,1fr)] gap-6 overflow-hidden p-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
              {/* ─── Left: committed visual stack + identity + reference ─── */}
              <FieldGroup className="overflow-y-auto pr-1">
                <Field>
                  <FieldLabel>{t("propImages")}</FieldLabel>
                  <PropImageSection
                    propId={propId}
                    images={form.propImgPath}
                    prompt={composerPrompt}
                    threeViewImagePath={form.threeViewsImagePath}
                    onImagesChange={(v) => setField("propImgPath", v)}
                    onThreeViewChange={(v) => setField("threeViewsImagePath", v)}
                  />
                </Field>

                <Field data-invalid={Boolean(errors.name)}>
                  <FieldLabel htmlFor="prop-name" required>
                    {t("propName")}
                  </FieldLabel>
                  <Input
                    id="prop-name"
                    value={form.name}
                    maxLength={20}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder={t("propNamePlaceholder")}
                    aria-invalid={Boolean(errors.name)}
                  />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="prop-desc">{t("propDescription")}</FieldLabel>
                  <Textarea
                    id="prop-desc"
                    value={form.description}
                    maxLength={300}
                    rows={4}
                    onChange={(e) => setField("description", e.target.value)}
                    placeholder={t("propDescriptionPlaceholder")}
                    className="resize-none"
                  />
                </Field>

                <Field>
                  <FieldLabel>{t("referenceImages")}</FieldLabel>
                  <ReferenceImageUploader
                    paths={form.referenceImgPath}
                    onChange={(v) => setField("referenceImgPath", v)}
                    addLabel={tc("addReferenceImage")}
                  />
                </Field>
              </FieldGroup>

              {/* ─── Right: AI gallery (flex-1) + composer ─── */}
              <div className="flex min-h-0 flex-col gap-4">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1">
                    {propId ? (
                      <AssetAiRecordPanel
                        ref={aiPanelRef}
                        assetId={propId}
                        columnKey={PROP_COLUMN_KEY}
                        prompt={composerPrompt}
                        model={imageModelId}
                        referenceImageUrl={form.referenceImgPath[0] ?? form.propImgPath[0]}
                        selectedPaths={form.propImgPath}
                        onSelect={handleSelectFromGallery}
                        onPreview={(path) => setPreviewImage(buildOssUrl(path))}
                      />
                    ) : (
                      <p className="rounded-md border border-dashed border-border/40 p-3 text-[11px] text-muted-foreground/60">
                        保存后才能生成 AI 道具图
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex flex-col gap-2 rounded-xl border border-border/40 bg-muted p-4 transition-colors focus-within:border-primary/30">
                  <Textarea
                    value={form.prompt}
                    onChange={(e) => setField("prompt", e.target.value)}
                    placeholder={tc("promptPlaceholder")}
                    maxLength={500}
                    rows={3}
                    className="min-h-0 resize-none border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
                  />
                  <div className="flex items-center justify-between">
                    <ModelPicker
                      models={imageModels}
                      value={imageModelId}
                      onChange={setImageModelId}
                      compact
                      contentClassName="bg-popover backdrop-blur-none backdrop-saturate-100 border-border"
                    />
                    <GenerateButton
                      onClick={() => aiPanelRef.current?.generate()}
                      cost={selectedImageModel?.cost}
                      className={
                        !propId || !composerPrompt.trim()
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
            {prop?.id ? (
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
                    <AlertDialogTitle>删除道具</AlertDialogTitle>
                    <AlertDialogDescription>
                      确定要删除「{form.name || t("unnamedProp")}」吗？此操作无法撤销。
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
            <Button onClick={() => void handleSave()} disabled={saving}>
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

      <MediaPreviewModal
        open={Boolean(previewImage)}
        onOpenChange={(next) => !next && setPreviewImage("")}
        type="image"
        src={previewImage}
        name={t("propImagePreview")}
        link={previewImage}
      />
    </>
  );
}
