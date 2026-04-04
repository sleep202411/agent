"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
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
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { backendApi } from "@/src/lib/api";
import { ReferenceImageUploader } from "../reference-image-uploader";
import { PropImageSection } from "./prop-image-section";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="px-6 py-5">
          <DialogTitle>{t("editProp")}</DialogTitle>
          <p className="sr-only">编辑道具信息</p>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-4">
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="prop-name">{t("propName")}</FieldLabel>
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
                rows={3}
                onChange={(e) => setField("description", e.target.value)}
                placeholder={t("propDescriptionPlaceholder")}
                className="resize-none"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="prop-prompt">{tc("prompt")}</FieldLabel>
              <Textarea
                id="prop-prompt"
                value={form.prompt}
                maxLength={500}
                rows={3}
                onChange={(e) => setField("prompt", e.target.value)}
                placeholder={tc("promptPlaceholder")}
                className="resize-none"
              />
            </Field>

            <Field>
              <FieldLabel>{t("propImages")}</FieldLabel>
              <PropImageSection
                propId={String(prop?.id ?? "")}
                images={form.propImgPath}
                prompt={form.prompt || form.description || ""}
                threeViewImagePath={form.threeViewsImagePath}
                referenceImagePaths={form.referenceImgPath}
                onImagesChange={(v) => setField("propImgPath", v)}
                onThreeViewChange={(v) => setField("threeViewsImagePath", v)}
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
        </div>

        <DialogFooter className="border-t p-4">
          {prop?.id && (
            <Button
              type="button"
              variant="soft"
              color="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="mr-auto"
            >
              {deleting ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconTrash className="size-3.5" />
              )}
              {tc("delete")}
            </Button>
          )}
          <Button type="button" variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <IconLoader2 className="size-3.5 animate-spin" />}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
