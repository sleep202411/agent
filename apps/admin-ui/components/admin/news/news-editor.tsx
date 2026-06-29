"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { IconArrowLeft, IconPencil, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ErrorBanner, Field, isoToLocalInput, localInputToIso, PageHeader } from "./shared";
import { RichTextEditor } from "./rich-text-editor";
import { NewsTagDialog } from "./news-tag-dialog";
import {
  emptyLocalizedContent,
  isLocaleFilled,
  newsKindLabel,
  resolveCoverUrl,
  NEWS_LOCALES,
  NEWS_PRIMARY_LOCALE,
  type NewsArticle,
  type NewsKind,
  type NewsLocaleCode,
  type NewsLocaleContent,
  type NewsStatus,
  type NewsTag,
} from "./types";
import type { AdminNewsSaveInput } from "@/lib/admin-news";

type NewsFormState = {
  id: string | null;
  createdAt: string | null;
  kind: NewsKind;
  url: string;
  author: string;
  status: NewsStatus;
  publishedAtLocal: string;
  tagIds: string[];
  localized: Record<NewsLocaleCode, NewsLocaleContent>;
};

export function NewsEditor({
  mode,
  existing,
  tags,
  loadError,
  siteLabel,
  databaseLabel,
}: {
  mode: "create" | "edit";
  existing: NewsArticle | null;
  tags: NewsTag[];
  loadError?: string | null;
  siteLabel: string;
  databaseLabel: string;
}) {
  const router = useRouter();

  const [form, setForm] = useState<NewsFormState>(() => initForm(existing, tags));
  const [activeLocale, setActiveLocale] = useState<NewsLocaleCode>(NEWS_PRIMARY_LOCALE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagDialogTarget, setTagDialogTarget] = useState<NewsTag | null>(null);

  const notFound = mode === "edit" && !existing;
  const activeContent = form.localized[activeLocale];
  const primaryContent = form.localized[NEWS_PRIMARY_LOCALE];
  const canSubmit =
    Boolean(primaryContent.title.trim()) &&
    (form.kind === "external" ? Boolean(form.url.trim()) : Boolean(primaryContent.body.trim())) &&
    (form.status !== "published" || Boolean(form.publishedAtLocal));

  function setLocaleField(field: keyof NewsLocaleContent, value: string) {
    setForm((prev) => ({
      ...prev,
      localized: {
        ...prev.localized,
        [activeLocale]: { ...prev.localized[activeLocale], [field]: value },
      },
    }));
  }

  // Cover upload via our media pipeline: request a signed URL → PUT bytes to
  // storage (Azure on .com / OSS on .cn) → confirm → write the resolved URL
  // into this locale's coverUrl. Server decides the key + region.
  async function handleCoverFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ""; // allow re-picking the same file
    if (!file) return;
    setCoverUploading(true);
    setCoverError(null);
    try {
      const urlRes = await fetch("/api/admin/media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "news_cover",
          contentType: file.type,
          fileName: file.name,
          sizeBytes: file.size,
        }),
      });
      const urlBody = (await urlRes.json().catch(() => null)) as {
        code?: number;
        msg?: string;
        data?: {
          uploadUrl: string;
          method: string;
          headers: Record<string, string>;
          storageKey: string;
        };
      } | null;
      if (!urlRes.ok || urlBody?.code !== 200 || !urlBody.data) {
        throw new Error(urlBody?.msg ?? `获取上传地址失败：${urlRes.status}`);
      }
      const { uploadUrl, method, headers, storageKey } = urlBody.data;

      const putRes = await fetch(uploadUrl, { method, headers, body: file });
      if (!putRes.ok) throw new Error(`上传到存储失败：${putRes.status}`);

      const confirmRes = await fetch("/api/admin/media/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey, kind: "news_cover", contentType: file.type }),
      });
      const confirmBody = (await confirmRes.json().catch(() => null)) as {
        code?: number;
        msg?: string;
        data?: { url: string };
      } | null;
      if (!confirmRes.ok || confirmBody?.code !== 200 || !confirmBody.data) {
        throw new Error(confirmBody?.msg ?? `确认上传失败：${confirmRes.status}`);
      }
      setLocaleField("coverUrl", confirmBody.data.url);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "封面上传失败。");
    } finally {
      setCoverUploading(false);
    }
  }

  async function save() {
    if (!canSubmit || saving) return;
    const now = new Date().toISOString();
    const publishedAt =
      form.status === "published"
        ? (localInputToIso(form.publishedAtLocal) ?? now)
        : localInputToIso(form.publishedAtLocal);
    const payload: AdminNewsSaveInput = {
      kind: form.kind,
      url: form.kind === "external" ? form.url.trim() : "",
      author: form.author.trim(),
      status: form.status,
      tagIds: [...form.tagIds],
      publishedAt,
      localized: cloneLocalized(form.localized),
    };
    setSaving(true);
    setSaveError(null);
    try {
      const response =
        mode === "edit" && form.id
          ? await fetch(`/api/admin/news/${form.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch("/api/admin/news", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `保存失败：${response.status}`);
      }
      router.push("/news");
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败。");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <button
        type="button"
        onClick={() => router.push("/news")}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 transition hover:text-slate-900"
      >
        <IconArrowLeft className="size-4" />
        新闻资讯
      </button>

      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title={mode === "edit" ? "编辑资讯" : "新建资讯"}
        description="至少填写简体中文标题；外部链接需填写跳转地址，内部文章需填写简体中文正文。"
      >
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/news")}>
            取消
          </Button>
          <Button type="button" onClick={save} disabled={notFound || !canSubmit || saving}>
            {saving ? "保存中…" : mode === "edit" ? "保存资讯" : "创建资讯"}
          </Button>
        </div>
      </PageHeader>

      {saveError ? <ErrorBanner message={saveError} /> : null}

      {notFound ? (
        <ErrorBanner
          message={loadError ? `资讯加载失败：${loadError}` : "未找到该资讯，可能已被删除。"}
        />
      ) : (
        <div className="space-y-4">
          {/* 卡片①：发布设置 */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <SectionLabel>发布设置</SectionLabel>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="内容类型">
                <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5">
                  {(["article", "external"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, kind }))}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1 text-[13px] font-medium transition",
                        form.kind === kind
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      {newsKindLabel(kind)}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="作者 / 来源">
                <Input
                  value={form.author}
                  onChange={(event) => setForm((prev) => ({ ...prev, author: event.target.value }))}
                  placeholder={
                    form.kind === "external" ? "Variety / TechCrunch" : "FizzDragon 运营组"
                  }
                  className="h-9"
                />
              </Field>

              <Field label="状态">
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, status: value as NewsStatus }))
                  }
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿</SelectItem>
                    <SelectItem value="published">已发布</SelectItem>
                    <SelectItem value="offline">已下线</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="发布时间"
                hint={form.status === "published" ? "已发布必须设置时间" : "留空则取当前时间"}
              >
                <Input
                  type="datetime-local"
                  value={form.publishedAtLocal}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, publishedAtLocal: event.target.value }))
                  }
                  className="h-9"
                />
              </Field>
            </div>

            <Field label="标签">
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => {
                  const active = form.tagIds.includes(tag.id);
                  return (
                    <span
                      key={tag.id}
                      className={cn(
                        "group/tag inline-flex items-center rounded-full border text-[12px] font-medium transition",
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            tagIds: active
                              ? prev.tagIds.filter((tagId) => tagId !== tag.id)
                              : [...prev.tagIds, tag.id],
                          }))
                        }
                        className="py-1 pl-2.5 pr-1"
                      >
                        {tag.label[NEWS_PRIMARY_LOCALE]}
                      </button>
                      <button
                        type="button"
                        title="编辑标签"
                        onClick={() => {
                          setTagDialogTarget(tag);
                          setTagDialogOpen(true);
                        }}
                        className={cn(
                          "rounded-full p-0.5 pr-1.5 transition",
                          active
                            ? "text-white/60 hover:text-white"
                            : "text-slate-300 hover:text-slate-600"
                        )}
                      >
                        <IconPencil className="size-3" />
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setTagDialogTarget(null);
                    setTagDialogOpen(true);
                  }}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
                >
                  <IconPlus className="size-3" />
                  新标签
                </button>
              </div>
            </Field>
          </section>

          {/* 卡片②：多语言内容 */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <SectionLabel>多语言内容</SectionLabel>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {NEWS_LOCALES.map((locale) => {
                  const filled = isLocaleFilled(form.localized[locale.code], form.kind);
                  return (
                    <button
                      key={locale.code}
                      type="button"
                      onClick={() => setActiveLocale(locale.code)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition",
                        activeLocale === locale.code
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          filled
                            ? "bg-emerald-400"
                            : activeLocale === locale.code
                              ? "bg-white/40"
                              : "bg-slate-300"
                        )}
                      />
                      {locale.short}
                      {locale.primary ? (
                        <span
                          className={cn(
                            "text-[10px]",
                            activeLocale === locale.code ? "text-white/70" : "text-slate-400"
                          )}
                        >
                          主
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="标题">
              <Input
                value={activeContent.title}
                onChange={(event) => setLocaleField("title", event.target.value)}
                placeholder={
                  activeLocale === NEWS_PRIMARY_LOCALE ? "资讯标题" : "留空回退到简体中文"
                }
                className="h-9"
              />
            </Field>

            <Field label="摘要" hint="用于列表卡片，建议 2–3 行">
              <Textarea
                value={activeContent.summary}
                onChange={(event) => setLocaleField("summary", event.target.value)}
                placeholder="一句话概括这条资讯"
                className="min-h-16"
              />
            </Field>

            {form.kind === "article" ? (
              <Field label="正文" hint="富文本编辑，存储为 Markdown（与站内详情页渲染一致）">
                <RichTextEditor
                  key={activeLocale}
                  value={activeContent.body}
                  onChange={(markdown) => setLocaleField("body", markdown)}
                  placeholder="开始撰写正文……"
                />
              </Field>
            ) : null}

            <Field label="封面图" hint="建议 16:9 · 可粘贴 URL 或上传(存到平台 OSS/Azure)">
              <div className="flex items-center gap-2">
                <Input
                  value={activeContent.coverUrl}
                  onChange={(event) => setLocaleField("coverUrl", event.target.value)}
                  placeholder="https://… 或点右侧上传"
                  className="h-9 flex-1"
                  inputMode="url"
                />
                <label
                  className={cn(
                    "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 transition hover:border-slate-300",
                    coverUploading && "pointer-events-none opacity-60"
                  )}
                >
                  {coverUploading ? "上传中…" : "上传"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={coverUploading}
                    onChange={(event) => void handleCoverFile(event)}
                  />
                </label>
              </div>
            </Field>
            {coverError ? <p className="text-[12px] text-red-600">{coverError}</p> : null}
            {activeContent.coverUrl ? (
              <div className="max-w-md overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveCoverUrl(activeContent.coverUrl)}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
              </div>
            ) : null}

            {form.kind === "external" ? (
              <Field label="外链地址" hint="点击资讯卡片将在新标签页打开该链接">
                <Input
                  value={form.url}
                  onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                  placeholder="https://example.com/article"
                  className="h-9"
                  inputMode="url"
                />
              </Field>
            ) : null}
          </section>
        </div>
      )}

      {tagDialogOpen ? (
        <NewsTagDialog
          key={tagDialogTarget?.id ?? "__new__"}
          target={tagDialogTarget}
          onClose={() => setTagDialogOpen(false)}
          onSaved={() => {
            setTagDialogOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
      {children}
    </h3>
  );
}

function initForm(article: NewsArticle | null, availableTags: NewsTag[]): NewsFormState {
  if (!article) {
    // New 资讯 defaults to the「全部」tag (id "all") when it exists.
    const defaultTagId = availableTags.find((tag) => tag.id === "all")?.id;
    return {
      id: null,
      createdAt: null,
      kind: "article",
      url: "",
      author: "",
      status: "draft",
      publishedAtLocal: "",
      tagIds: defaultTagId ? [defaultTagId] : [],
      localized: emptyLocalizedContent(),
    };
  }
  return {
    id: article.id,
    createdAt: article.createdAt,
    kind: article.kind,
    url: article.url,
    author: article.author,
    status: article.status,
    publishedAtLocal: isoToLocalInput(article.publishedAt),
    tagIds: [...article.tagIds],
    localized: cloneLocalized(article.localized),
  };
}

function cloneLocalized(
  localized: Record<NewsLocaleCode, NewsLocaleContent>
): Record<NewsLocaleCode, NewsLocaleContent> {
  return {
    "zh-CN": { ...localized["zh-CN"] },
    "en-US": { ...localized["en-US"] },
    "zh-HK": { ...localized["zh-HK"] },
  };
}
