"use client";

import { useState } from "react";
import { IconRefresh, IconTags } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  InputLike,
  PageHeader,
  requestEnvelope,
  Select,
  StatusPill,
  taxonomyStatusLabel,
  toErrorMessage,
} from "./shared";
import type {
  AdminIpTaxonomyData,
  CreateTaxonomyTermDraft,
  IpTaxonomyLocalization,
  IpTaxonomyTerm,
  UpdateTaxonomyTermDraft,
} from "./types";
import { emptyIpTaxonomy } from "./types";

type TaxonomyFormState = {
  id: string | null;
  type: "genre" | "tag";
  code: string;
  status: "active" | "hidden" | "archived";
  displayOrder: string;
  zhCN: string;
  enUS: string;
  zhHK: string;
  description: string;
};

export function IpTaxonomyPanel({
  siteLabel,
  databaseLabel,
  initialTaxonomy,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialTaxonomy: AdminIpTaxonomyData | null;
  initialError: string | null;
}) {
  const [taxonomy, setTaxonomy] = useState(initialTaxonomy ?? emptyIpTaxonomy);
  const [locale, setLocale] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [form, setForm] = useState<TaxonomyFormState>(() => emptyTaxonomyForm());
  const genres = taxonomy.items.filter((term) => term.type === "genre");
  const tags = taxonomy.items.filter((term) => term.type === "tag");
  const editing = Boolean(form.id);
  const canSubmit = Boolean(form.zhCN.trim() || form.enUS.trim() || form.zhHK.trim()) && !loading;

  function localeQueryString() {
    const params = new URLSearchParams();
    if (locale) params.set("locale", locale);
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  async function refreshTaxonomy() {
    setLoading(true);
    setError(null);
    try {
      setTaxonomy(
        await requestEnvelope<AdminIpTaxonomyData>(
          `/api/admin/ip-commerce/taxonomy${localeQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function createTaxonomyTerm(input: CreateTaxonomyTermDraft) {
    setLoading(true);
    setError(null);
    try {
      await requestEnvelope<{ term: IpTaxonomyTerm }>("/api/admin/ip-commerce/taxonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      await refreshTaxonomy();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function updateTaxonomyTerm(termId: string, input: UpdateTaxonomyTermDraft) {
    setLoading(true);
    setError(null);
    try {
      await requestEnvelope<{ term: IpTaxonomyTerm }>(
        `/api/admin/ip-commerce/taxonomy/${encodeURIComponent(termId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      await refreshTaxonomy();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function editTerm(term: IpTaxonomyTerm) {
    setForm({
      id: term.id,
      type: term.type,
      code: term.code,
      status: term.status,
      displayOrder: String(term.displayOrder),
      zhCN: taxonomyLabel(term, "zh-CN"),
      enUS: taxonomyLabel(term, "en-US"),
      zhHK: taxonomyLabel(term, "zh-HK"),
      description: term.description ?? "",
    });
  }

  function submit() {
    if (!canSubmit) return;
    const displayOrder = Number.parseInt(form.displayOrder, 10);
    const localizations = taxonomyLocalizationsFromForm(form);
    if (!localizations.length) return;

    if (form.id) {
      void updateTaxonomyTerm(form.id, {
        status: form.status,
        displayOrder: Number.isFinite(displayOrder) ? displayOrder : 0,
        localizations,
      });
    } else {
      void createTaxonomyTerm({
        type: form.type,
        code: form.code.trim() || undefined,
        status: form.status,
        displayOrder: Number.isFinite(displayOrder) ? displayOrder : 0,
        localizations,
      });
      setForm(emptyTaxonomyForm(form.type));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 题材词库"
        description="维护跨语言题材和标签词条。code 是稳定业务标识，展示文案通过本地化记录承载。"
      >
        <div className="flex items-center gap-2">
          <Select value={locale} onChange={setLocale} aria-label="词库语言">
            <option value="">默认语言</option>
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
            <option value="zh-HK">繁體中文</option>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshTaxonomy()}
            disabled={loading}
          >
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </PageHeader>

      {error ? <ErrorBanner message={error} /> : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <IconTags className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-950">词条列表</h3>
          </div>
          <div className="grid gap-0 lg:grid-cols-2">
            <TaxonomyList title="题材" terms={genres} onEdit={editTerm} />
            <TaxonomyList title="标签" terms={tags} onEdit={editTerm} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                {editing ? "编辑词条" : "新增词条"}
              </h3>
              <p className="mt-1 text-[12px] leading-5 text-slate-500">
                code 留空时后端自动生成；上线后不要随意改动已有 code。
              </p>
            </div>
            {editing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm(emptyTaxonomyForm(form.type))}
                disabled={loading}
              >
                新增
              </Button>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={form.type}
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, type: value as "genre" | "tag" }))
                }
              >
                <option value="genre">题材</option>
                <option value="tag">标签</option>
              </Select>
              <Select
                value={form.status}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    status: value as "active" | "hidden" | "archived",
                  }))
                }
              >
                <option value="active">启用</option>
                <option value="hidden">隐藏</option>
                <option value="archived">归档</option>
              </Select>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
              <InputLike
                value={form.code}
                onChange={(value) => setForm((prev) => ({ ...prev, code: value }))}
                placeholder="code，可留空自动生成"
                disabled={editing}
              />
              <InputLike
                value={form.displayOrder}
                onChange={(value) => setForm((prev) => ({ ...prev, displayOrder: value }))}
                placeholder="排序"
              />
            </div>
            <InputLike
              value={form.zhCN}
              onChange={(value) => setForm((prev) => ({ ...prev, zhCN: value }))}
              placeholder="简体中文名称"
            />
            <InputLike
              value={form.enUS}
              onChange={(value) => setForm((prev) => ({ ...prev, enUS: value }))}
              placeholder="English label"
            />
            <InputLike
              value={form.zhHK}
              onChange={(value) => setForm((prev) => ({ ...prev, zhHK: value }))}
              placeholder="繁體中文名稱"
            />
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="内部说明或运营口径"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" size="sm" onClick={submit} disabled={!canSubmit}>
              {editing ? "保存词条" : "创建词条"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TaxonomyList({
  title,
  terms,
  onEdit,
}: {
  title: string;
  terms: IpTaxonomyTerm[];
  onEdit: (term: IpTaxonomyTerm) => void;
}) {
  return (
    <div className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r last:lg:border-r-0">
      <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        {title}
      </h4>
      <div className="mt-2 divide-y divide-slate-100">
        {terms.map((term) => (
          <div key={term.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-slate-950">{term.label}</p>
                <StatusPill tone={term.status === "active" ? "success" : "muted"}>
                  {taxonomyStatusLabel(term.status)}
                </StatusPill>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-slate-500">
                {term.code} · {term.assignmentCount} IP · 排序 {term.displayOrder}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onEdit(term)}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
            >
              编辑
            </button>
          </div>
        ))}
        {!terms.length ? <p className="py-6 text-sm text-slate-500">暂无词条</p> : null}
      </div>
    </div>
  );
}

function emptyTaxonomyForm(type: "genre" | "tag" = "genre"): TaxonomyFormState {
  return {
    id: null,
    type,
    code: "",
    status: "active",
    displayOrder: type === "genre" ? "100" : "1100",
    zhCN: "",
    enUS: "",
    zhHK: "",
    description: "",
  };
}

function taxonomyLabel(term: IpTaxonomyTerm, locale: string) {
  return term.localizations.find((item) => item.locale === locale)?.label ?? "";
}

function taxonomyLocalizationsFromForm(form: TaxonomyFormState): IpTaxonomyLocalization[] {
  return [
    { locale: "zh-CN", label: form.zhCN.trim() },
    { locale: "en-US", label: form.enUS.trim() },
    { locale: "zh-HK", label: form.zhHK.trim() },
  ]
    .filter((item) => item.label)
    .map((item) => ({
      ...item,
      description: form.description.trim() || null,
      aliases: [],
    }));
}
