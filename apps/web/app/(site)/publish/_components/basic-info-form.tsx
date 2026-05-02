"use client";

import { useState } from "react";
import { IconX, IconPlus } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/src/i18n/i18n";
import { TagSelectorModal } from "./tag-selector-modal";
import type { Tag } from "../_hooks/use-publish";

export interface BasicInfoFormValue {
  title: string;
  description: string;
  tagIds: number[];
}

interface Props {
  value: BasicInfoFormValue;
  onChange: (next: BasicInfoFormValue) => void;
  tags: Tag[];
}

export function BasicInfoForm({ value, onChange, tags }: Props) {
  const t = useTranslations("publishVideo");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const selected = value.tagIds.map((id) => tagById.get(id)).filter((x): x is Tag => Boolean(x));

  const removeTag = (id: number) => {
    onChange({ ...value, tagIds: value.tagIds.filter((x) => x !== id) });
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t("videoTitle")} <span className="text-destructive">*</span>
        </label>
        <Input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={t("videoTitlePlaceholder")}
          maxLength={80}
        />
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t("videoTags")} <span className="text-destructive">*</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                className="rounded-full p-0.5 hover:bg-primary/20"
                aria-label="remove"
              >
                <IconX className="size-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setTagDialogOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-secondary/30 px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <IconPlus className="size-3.5" />
            {selected.length > 0 ? t("modifyTag") : t("selectTag")}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t("videoDescription")} <span className="text-destructive">*</span>
        </label>
        <Textarea
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder={t("videoDescriptionPlaceholder")}
          maxLength={500}
          rows={5}
        />
        <div className="text-right text-xs text-muted-foreground">
          {value.description.length}/500
        </div>
      </div>

      <TagSelectorModal
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        tags={tags}
        selectedIds={value.tagIds}
        onConfirm={(ids) => onChange({ ...value, tagIds: ids })}
      />
    </div>
  );
}
