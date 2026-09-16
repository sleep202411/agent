"use client";

import { useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { adminUiApiPath } from "@/lib/admin-api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./shared";
import { NEWS_LOCALES, type NewsLocaleCode, type NewsTag } from "./types";

/**
 * Create / edit a 资讯 tag (Java POST /tags · PUT /tags/{id}). Mounted keyed by
 * the target so state resets per open; the parent unmounts it on close.
 */
export function NewsTagDialog(props: Parameters<typeof NewsTagDialogContent>[0]) {
  return <NewsTagDialogContent key={props.target?.id ?? "new"} {...props} />;
}

function NewsTagDialogContent({
  target,
  onClose,
  onSaved,
}: {
  /** null = create a new tag; a tag = edit it. */
  target: NewsTag | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = target !== null;
  const [id, setId] = useState("");
  const [label, setLabel] = useState<Record<NewsLocaleCode, string>>(() => ({
    "zh-CN": target?.label["zh-CN"] ?? "",
    "en-US": target?.label["en-US"] ?? "",
    "zh-HK": target?.label["zh-HK"] ?? "",
  }));
  const { busy: saving, begin } = useAdminOperation();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = NEWS_LOCALES.some((locale) => label[locale.code].trim());

  async function save() {
    if (!canSave || saving || saved) return;
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      const response = target
        ? await fetch(adminUiApiPath(`/api/admin/news/tags/${encodeURIComponent(target.id)}`), {
            signal: operation.signal,
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
          })
        : await fetch(adminUiApiPath("/api/admin/news/tags"), {
            signal: operation.signal,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label, ...(id.trim() ? { id: id.trim() } : {}) }),
          });
      if (!operation.current()) return;
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!operation.current()) return;
        throw new Error(payload?.error ?? `保存失败：${response.status}`);
      }
      setSaved(true);
      onSaved();
    } catch (err) {
      if (operation.current()) setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      operation.finish();
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑标签" : "新建标签"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!isEdit ? (
            <Field label="标签 ID" hint="留空则按英文名自动生成，如 tag_product">
              <Input
                disabled={saving || saved}
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="tag_xxx（可选）"
                className="h-9"
              />
            </Field>
          ) : null}
          {NEWS_LOCALES.map((locale) => (
            <Field key={locale.code} label={`${locale.label}名称`}>
              <Input
                disabled={saving || saved}
                value={label[locale.code]}
                onChange={(event) =>
                  setLabel((prev) => ({ ...prev, [locale.code]: event.target.value }))
                }
                placeholder={locale.primary ? "标签名" : "留空回退到简体"}
                className="h-9"
              />
            </Field>
          ))}
          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button disabled={!canSave || saving || saved} onClick={save}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
