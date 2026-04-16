import { IconUpload, IconX, IconInfoCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { PROJECT_TYPES, SUGGESTED_TAGS, type IPCreateForm } from "@/components/ip/ip-mock";

interface Props {
  form: IPCreateForm;
  update: (patch: Partial<IPCreateForm>) => void;
}

export function StepBasicInfo({ form, update }: Props) {
  const t = useTranslations("ipCreate");

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || form.tags.length >= 10 || form.tags.includes(trimmed)) return;
    update({ tags: [...form.tags, trimmed] });
  };

  const removeTag = (tag: string) => {
    update({ tags: form.tags.filter((t) => t !== tag) });
  };

  return (
    <div className="space-y-6">
      {/* Cover upload */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">{t("cover")}</label>
        {form.coverImage ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border">
            <img src={form.coverImage} alt="" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => update({ coverImage: null })}
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            >
              <IconX className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-secondary/50 transition-colors hover:border-primary/40">
            <IconUpload className="mb-2 size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("coverHint")}</p>
            <p className="mt-1 text-xs text-muted-foreground/60">{t("coverSpec")}</p>
          </div>
        )}
      </div>

      {/* Title */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("title")} <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={form.title}
            onChange={(e) => update({ title: e.target.value.slice(0, 50) })}
            placeholder={t("titlePlaceholder")}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {form.title.length}/50
          </span>
        </div>
      </div>

      {/* Project type */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("projectType")} <span className="text-destructive">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {PROJECT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => update({ projectType: type })}
              className={cn(
                "rounded-lg border px-4 py-2 text-xs font-medium transition-all",
                form.projectType === type
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`type_${type}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("description")} <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <textarea
            value={form.description}
            onChange={(e) => update({ description: e.target.value.slice(0, 500) })}
            placeholder={t("descPlaceholder")}
            rows={4}
            className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="absolute bottom-3 right-3 text-xs text-muted-foreground">
            {form.description.length}/500
          </span>
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("tags")} <span className="text-xs text-muted-foreground">({t("tagsMax")})</span>
        </label>
        <input
          type="text"
          placeholder={t("tagsPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).value = "";
            }
          }}
          className="mb-3 w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGGESTED_TAGS.filter((t) => !form.tags.includes(t)).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              + {tag}
            </button>
          ))}
        </div>
        {form.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="hover:text-primary/70"
                >
                  <IconX className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Info tip */}
      <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">{t("basicInfoTip")}</p>
      </div>
    </div>
  );
}
