"use client";

import { useMemo, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { IconLanguage, IconPlus, IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  Metric,
  PageHeader,
  requestEnvelope,
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

// shadcn SelectItem value cannot be an empty string, so the "默认语言" option uses
// this sentinel and maps back to "" in the onValueChange handler.
const LOCALE_ALL = "__all__";

// The standard locales a term should carry; drives the completeness chips/metric.
const LOCALES = [
  { code: "zh-CN", short: "简", label: "简体中文" },
  { code: "en-US", short: "EN", label: "English" },
  { code: "zh-HK", short: "繁", label: "繁體中文" },
] as const;

const TYPE_TABS = [
  { value: "all", label: "全部" },
  { value: "genre", label: "题材" },
  { value: "tag", label: "标签" },
] as const;

type TypeFilter = (typeof TYPE_TABS)[number]["value"];
type StatusFilter = "all" | "active" | "hidden" | "archived";

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
  aliasesByLocale: Record<string, string[]>;
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
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<TaxonomyFormState>(() => emptyTaxonomyForm());
  const editing = Boolean(form.id);
  const displayOrder = Number(form.displayOrder);
  const validDisplayOrder =
    form.displayOrder.trim() !== "" &&
    Number.isInteger(displayOrder) &&
    displayOrder >= 0 &&
    displayOrder <= 1_000_000;
  const canSubmit =
    Boolean(form.zhCN.trim() || form.enUS.trim() || form.zhHK.trim()) &&
    validDisplayOrder &&
    !loading;

  const metrics = useMemo(() => {
    const items = taxonomy.items;
    return {
      genre: items.filter((t) => t.type === "genre").length,
      tag: items.filter((t) => t.type === "tag").length,
      active: items.filter((t) => t.status === "active").length,
      incomplete: items.filter((t) => !isComplete(t)).length,
    };
  }, [taxonomy.items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return taxonomy.items.filter((term) => {
      if (typeFilter !== "all" && term.type !== typeFilter) return false;
      if (statusFilter !== "all" && term.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [term.label, term.code, ...term.localizations.map((l) => l.label)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [taxonomy.items, query, typeFilter, statusFilter]);

  function localeQueryString(nextLocale = locale) {
    const params = new URLSearchParams();
    if (nextLocale) params.set("locale", nextLocale);
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  const readTaxonomy = (nextLocale: string, signal: AbortSignal) =>
    requestEnvelope<AdminIpTaxonomyData>(
      `/api/admin/ip-commerce/taxonomy${localeQueryString(nextLocale)}`,
      { signal }
    );

  async function refreshTaxonomy(nextLocale = locale) {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const next = await readTaxonomy(nextLocale, operation.signal);
      if (operation.current()) setTaxonomy(next);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function saveTaxonomyTerm(
    termId: string | null,
    input: CreateTaxonomyTermDraft | UpdateTaxonomyTermDraft
  ): Promise<boolean> {
    const operation = begin();
    if (!operation) return false;
    setError(null);
    try {
      await requestEnvelope<{ term: IpTaxonomyTerm }>(
        `/api/admin/ip-commerce/taxonomy${termId ? `/${encodeURIComponent(termId)}` : ""}`,
        {
          method: termId ? "PATCH" : "POST",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!operation.current()) return false;
      // A failed read must not turn an acknowledged write into a retryable save.
      try {
        const next = await readTaxonomy(locale, operation.signal);
        if (!operation.current()) return false;
        setTaxonomy(next);
      } catch (err) {
        if (!operation.current()) return false;
        setError(toErrorMessage(err));
      }
      return true;
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
      return false;
    } finally {
      operation.finish();
    }
  }

  function openCreate() {
    if (loading) return;
    setForm(emptyTaxonomyForm(typeFilter === "tag" ? "tag" : "genre"));
    setSheetOpen(true);
  }

  function openEdit(term: IpTaxonomyTerm) {
    if (loading) return;
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
      aliasesByLocale: Object.fromEntries(
        term.localizations.map((item) => [item.locale, [...item.aliases]])
      ),
    });
    setSheetOpen(true);
  }

  async function submit() {
    if (!canSubmit) return;
    const localizations = taxonomyLocalizationsFromForm(form);
    if (!localizations.length) return;

    const ok = form.id
      ? await saveTaxonomyTerm(form.id, {
          status: form.status,
          displayOrder,
          localizations,
        })
      : await saveTaxonomyTerm(null, {
          type: form.type,
          code: form.code.trim() || undefined,
          status: form.status,
          displayOrder,
          localizations,
        });

    if (ok) setSheetOpen(false);
  }

  const columns: ColumnDef<IpTaxonomyTerm, unknown>[] = [
    {
      accessorKey: "label",
      header: "词条",
      cell: ({ row }) => {
        const term = row.original;
        return (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-950">{term.label || "—"}</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-slate-500">{term.code}</p>
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: "类型",
      cell: ({ row }) => (
        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">
          {row.original.type === "genre" ? "题材" : "标签"}
        </span>
      ),
    },
    {
      id: "locales",
      header: "多语言",
      enableSorting: false,
      cell: ({ row }) => <LocaleChips term={row.original} />,
    },
    {
      accessorKey: "assignmentCount",
      header: "关联 IP",
      cell: ({ row }) => <span className="tabular-nums">{row.original.assignmentCount}</span>,
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => (
        <StatusPill tone={row.original.status === "active" ? "success" : "muted"}>
          {taxonomyStatusLabel(row.original.status)}
        </StatusPill>
      ),
    },
    {
      accessorKey: "displayOrder",
      header: "排序",
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-600">{row.original.displayOrder}</span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: { pin: "right" },
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => openEdit(row.original)}
        >
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="IP 题材词库"
        description="维护跨语言题材和标签词条。code 是稳定业务标识，展示文案通过本地化记录承载。"
      >
        <div className="flex items-center gap-2">
          <Select
            disabled={loading}
            value={locale || LOCALE_ALL}
            onValueChange={(value) => {
              const nextLocale = value === LOCALE_ALL ? "" : value;
              setLocale(nextLocale);
              void refreshTaxonomy(nextLocale);
            }}
          >
            <SelectTrigger className="h-9 w-[136px]" aria-label="词库语言">
              <IconLanguage className="size-3.5 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={LOCALE_ALL}>默认语言</SelectItem>
              <SelectItem value="zh-CN">简体中文</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
              <SelectItem value="zh-HK">繁體中文</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshTaxonomy()}
            disabled={loading}
            aria-label="刷新词库"
          >
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button type="button" size="sm" disabled={loading} onClick={openCreate}>
            <IconPlus className="size-4" />
            新增词条
          </Button>
        </div>
      </PageHeader>

      {error ? <ErrorBanner message={error} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="题材" value={metrics.genre} />
        <Metric label="标签" value={metrics.tag} />
        <Metric label="启用" value={metrics.active} />
        <Metric
          label="缺翻译"
          value={metrics.incomplete}
          tone={metrics.incomplete > 0 ? "risk" : "default"}
        />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索词条名称或 code"
            className="h-9 pl-8"
            aria-label="搜索词条"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setTypeFilter(tab.value)}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium transition",
                  typeFilter === tab.value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="h-9 w-[116px]" aria-label="状态筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">启用</SelectItem>
              <SelectItem value="hidden">隐藏</SelectItem>
              <SelectItem value="archived">归档</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        minWidth={760}
        pageSize={20}
        emptyLabel={
          query || typeFilter !== "all" || statusFilter !== "all" ? "没有匹配的词条" : "暂无词条"
        }
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={(next) => {
          if (loading) return;
          setSheetOpen(next);
        }}
      >
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-slate-200 px-5 py-4">
            <SheetTitle>{editing ? "编辑词条" : "新增词条"}</SheetTitle>
            <SheetDescription>
              code 留空时后端自动生成；上线后不要随意改动已有 code。至少填写一种语言的名称。
            </SheetDescription>
          </SheetHeader>

          <div inert={loading} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="类型">
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, type: value as "genre" | "tag" }))
                  }
                  disabled={editing}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="genre">题材</SelectItem>
                    <SelectItem value="tag">标签</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="状态">
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      status: value as "active" | "hidden" | "archived",
                    }))
                  }
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="hidden">隐藏</SelectItem>
                    <SelectItem value="archived">归档</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
              <Field label="code">
                <Input
                  value={form.code}
                  onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="留空自动生成"
                  disabled={editing}
                  className="h-9"
                />
              </Field>
              <Field label="排序">
                <Input
                  value={form.displayOrder}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, displayOrder: event.target.value }))
                  }
                  placeholder="排序"
                  className="h-9"
                  inputMode="numeric"
                  aria-invalid={!validDisplayOrder}
                  aria-describedby={!validDisplayOrder ? "taxonomy-order-error" : undefined}
                />
                {!validDisplayOrder && (
                  <p id="taxonomy-order-error" role="alert" className="text-xs text-red-700">
                    Enter a whole number from 0 to 1,000,000.
                  </p>
                )}
              </Field>
            </div>
            <Field label="简体中文名称">
              <Input
                value={form.zhCN}
                onChange={(event) => setForm((prev) => ({ ...prev, zhCN: event.target.value }))}
                placeholder="简体中文名称"
                className="h-9"
              />
            </Field>
            <Field label="English label">
              <Input
                value={form.enUS}
                onChange={(event) => setForm((prev) => ({ ...prev, enUS: event.target.value }))}
                placeholder="English label"
                className="h-9"
              />
            </Field>
            <Field label="繁體中文名稱">
              <Input
                value={form.zhHK}
                onChange={(event) => setForm((prev) => ({ ...prev, zhHK: event.target.value }))}
                placeholder="繁體中文名稱"
                className="h-9"
              />
            </Field>
            <Field label="内部说明">
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                className="min-h-20"
                placeholder="内部说明或运营口径（可选）"
              />
            </Field>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSheetOpen(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {loading ? (editing ? "保存中" : "创建中") : editing ? "保存词条" : "创建词条"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function LocaleChips({ term }: { term: IpTaxonomyTerm }) {
  return (
    <div className="flex gap-1">
      {LOCALES.map((l) => {
        const has = term.localizations.some((item) => item.locale === l.code && item.label.trim());
        return (
          <span
            key={l.code}
            title={has ? l.label : `${l.label} · 缺翻译`}
            className={cn(
              "inline-flex h-5 min-w-[26px] items-center justify-center rounded px-1 text-[11px] font-medium",
              has ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-300 line-through"
            )}
          >
            {l.short}
          </span>
        );
      })}
    </div>
  );
}

function isComplete(term: IpTaxonomyTerm): boolean {
  return LOCALES.every((l) =>
    term.localizations.some((item) => item.locale === l.code && item.label.trim())
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
    aliasesByLocale: {},
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
      aliases: form.aliasesByLocale[item.locale] ?? [],
    }));
}
