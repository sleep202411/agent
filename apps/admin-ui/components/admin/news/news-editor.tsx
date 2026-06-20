"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
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
import { getNews, listNewsTags, newNewsId, upsertNews } from "./news-store";
import { RichTextEditor } from "./rich-text-editor";
import {
  emptyLocalizedContent,
  isLocaleFilled,
  newsKindLabel,
  NEWS_LOCALES,
  NEWS_PRIMARY_LOCALE,
  type NewsArticle,
  type NewsKind,
  type NewsLocaleCode,
  type NewsLocaleContent,
  type NewsStatus,
} from "./types";

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
  id,
  siteLabel,
  databaseLabel,
}: {
  mode: "create" | "edit";
  id?: string;
  siteLabel: string;
  databaseLabel: string;
}) {
  const router = useRouter();
  const tags = useMemo(() => listNewsTags(), []);
  const existing = useMemo(() => (mode === "edit" && id ? getNews(id) : undefined), [mode, id]);

  const [form, setForm] = useState<NewsFormState>(() => initForm(existing));
  const [activeLocale, setActiveLocale] = useState<NewsLocaleCode>(NEWS_PRIMARY_LOCALE);

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

  function save() {
    if (!canSubmit) return;
    const now = new Date().toISOString();
    const publishedAt =
      form.status === "published"
        ? (localInputToIso(form.publishedAtLocal) ?? now)
        : localInputToIso(form.publishedAtLocal);
    // TODO(backend): replace upsertNews() with POST/PATCH /api/admin/news.
    const article: NewsArticle = {
      id: form.id ?? newNewsId(),
      kind: form.kind,
      url: form.kind === "external" ? form.url.trim() : "",
      author: form.author.trim(),
      status: form.status,
      tagIds: [...form.tagIds],
      publishedAt,
      localized: cloneLocalized(form.localized),
      createdAt: form.createdAt ?? now,
      updatedAt: now,
    };
    upsertNews(article);
    router.push("/news");
  }

  return (
    <div className="space-y-4">
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
          <Button type="button" onClick={save} disabled={notFound || !canSubmit}>
            {mode === "edit" ? "保存资讯" : "创建资讯"}
          </Button>
        </div>
      </PageHeader>

      {notFound ? (
        <ErrorBanner message="未找到该资讯，可能已被删除或会话已重置。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* 内容 */}
          <div className="space-y-5">
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

            <section className="space-y-3">
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

              <Field label="封面图地址" hint="建议 16:9">
                <Input
                  value={activeContent.coverUrl}
                  onChange={(event) => setLocaleField("coverUrl", event.target.value)}
                  placeholder="https://… 或上传后填入地址"
                  className="h-9"
                  inputMode="url"
                />
              </Field>
              {activeContent.coverUrl ? (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeContent.coverUrl}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                </div>
              ) : null}
            </section>
          </div>

          {/* 发布设置 */}
          <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4">
            <SectionLabel>发布设置</SectionLabel>

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
              hint={
                form.status === "published"
                  ? "已发布状态必须设置发布时间"
                  : "可选，留空则发布时取当前时间"
              }
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

            <Field label="标签">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const active = form.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          tagIds: active
                            ? prev.tagIds.filter((tagId) => tagId !== tag.id)
                            : [...prev.tagIds, tag.id],
                        }))
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {tag.label[NEWS_PRIMARY_LOCALE]}
                    </button>
                  );
                })}
              </div>
            </Field>
          </aside>
        </div>
      )}
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

function initForm(article: NewsArticle | undefined): NewsFormState {
  if (!article) {
    return {
      id: null,
      createdAt: null,
      kind: "article",
      url: "",
      author: "",
      status: "draft",
      publishedAtLocal: "",
      tagIds: [],
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
