"use client";

import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { adminUiApiPath } from "@/lib/admin-api";
import { IconLoader2, IconPhoto, IconPlus, IconRefresh, IconUpload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  ErrorBanner,
  Metric,
  PageHeader,
  requestEnvelope,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type { AdminIpPublishersData, IpPublisherRow } from "./types";

const emptyPublishers: AdminIpPublishersData = { items: [] };

type FormState = {
  id: string | null;
  code: string;
  status: "active" | "inactive";
  zhCN: string;
  enUS: string;
  zhHK: string;
  logoUrl: string;
  notes: string;
};

function emptyForm(): FormState {
  return {
    id: null,
    code: "",
    status: "active",
    zhCN: "",
    enUS: "",
    zhHK: "",
    logoUrl: "",
    notes: "",
  };
}

function formFromRow(row: IpPublisherRow): FormState {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    zhCN: row.names["zh-CN"] ?? "",
    enUS: row.names["en-US"] ?? "",
    zhHK: row.names["zh-HK"] ?? "",
    logoUrl: row.logoUrl,
    notes: row.notes ?? "",
  };
}

/** Stable lowercase code from the English display name (no manual code field). */
function codeFromEnglishName(enUS: string): string | null {
  const cleaned = enUS
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (/^[a-z][a-z0-9_-]{1,63}$/.test(cleaned)) return cleaned;
  return null;
}

function FormLabel({
  children,
  required,
  optional,
}: {
  children: ReactNode;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1 text-[12px] font-medium text-slate-600">
      {children}
      {required ? <span className="text-red-500">*</span> : null}
      {optional ? <span className="font-normal text-slate-400">可选</span> : null}
    </span>
  );
}

function StatusSegment({
  value,
  disabled,
  onChange,
}: {
  value: FormState["status"];
  disabled?: boolean;
  onChange: (next: FormState["status"]) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {(
        [
          { id: "active", label: "启用" },
          { id: "inactive", label: "停用" },
        ] as const
      ).map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              "h-8 rounded-md px-3 text-[13px] font-medium transition",
              active
                ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 hover:text-slate-800",
              disabled && "opacity-60"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function IpPublishersPanel({
  siteLabel,
  databaseLabel,
  initialPublishers,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialPublishers: AdminIpPublishersData | null;
  initialError: string | null;
}) {
  const [publishers, setPublishers] = useState(initialPublishers ?? emptyPublishers);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const editing = Boolean(form.id);

  const metrics = useMemo(
    () => ({
      total: publishers.items.length,
      active: publishers.items.filter((row) => row.status === "active").length,
      linked: publishers.items.reduce((sum, row) => sum + row.assignmentCount, 0),
    }),
    [publishers.items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return publishers.items.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.code.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        Object.values(row.names).some((name) => name?.toLowerCase().includes(q))
      );
    });
  }, [publishers.items, query, statusFilter]);

  const canSubmit =
    Boolean(form.zhCN.trim()) &&
    Boolean(form.enUS.trim()) &&
    Boolean(form.zhHK.trim()) &&
    Boolean(form.logoUrl.trim()) &&
    (editing || Boolean(codeFromEnglishName(form.enUS))) &&
    !loading &&
    !logoUploading;

  function openCreate() {
    setForm(emptyForm());
    setLogoError(null);
    setDialogOpen(true);
  }

  function openEdit(row: IpPublisherRow) {
    setForm(formFromRow(row));
    setLogoError(null);
    setDialogOpen(true);
  }

  async function reload() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const next = await requestEnvelope<AdminIpPublishersData>(
        "/api/admin/ip-commerce/publishers",
        { signal: operation.signal }
      );
      if (operation.current()) setPublishers(next);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function uploadLogo(file: File) {
    const operation = begin();
    if (!operation) return;
    setLogoUploading(true);
    setLogoError(null);
    try {
      const urlRes = await fetch(adminUiApiPath("/api/admin/media/upload-url"), {
        signal: operation.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ip_banner",
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
      if (!operation.current()) return;
      if (!urlRes.ok || urlBody?.code !== 200 || !urlBody.data) {
        throw new Error(urlBody?.msg ?? `获取上传地址失败：${urlRes.status}`);
      }
      const { uploadUrl, method, headers, storageKey } = urlBody.data;

      const putRes = await fetch(uploadUrl, {
        method,
        headers,
        body: file,
        signal: operation.signal,
      });
      if (!operation.current()) return;
      if (!putRes.ok) throw new Error(`上传到存储失败：${putRes.status}`);

      const confirmRes = await fetch(adminUiApiPath("/api/admin/media/confirm"), {
        signal: operation.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKey,
          kind: "ip_banner",
          contentType: file.type,
        }),
      });
      const confirmBody = (await confirmRes.json().catch(() => null)) as {
        code?: number;
        msg?: string;
        data?: { url: string };
      } | null;
      if (!operation.current()) return;
      if (!confirmRes.ok || confirmBody?.code !== 200 || !confirmBody.data?.url) {
        throw new Error(confirmBody?.msg ?? `确认上传失败：${confirmRes.status}`);
      }
      setForm((current) => ({ ...current, logoUrl: confirmBody.data!.url }));
    } catch (err) {
      if (operation.current()) {
        setLogoError(err instanceof Error ? err.message : "Logo 上传失败");
      }
    } finally {
      setLogoUploading(false);
      operation.finish();
    }
  }

  function handleLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("请选择图片文件（PNG / JPG / WebP）");
      return;
    }
    void uploadLogo(file);
  }

  async function submit() {
    if (!canSubmit) return;
    const operation = begin();
    if (!operation) return;
    setError(null);
    const names = {
      "zh-CN": form.zhCN.trim(),
      "en-US": form.enUS.trim(),
      "zh-HK": form.zhHK.trim(),
    };
    const code = editing ? form.code : codeFromEnglishName(form.enUS);
    if (!code) return;

    const body = editing
      ? {
          status: form.status,
          names,
          logoUrl: form.logoUrl.trim(),
          notes: form.notes.trim() || null,
        }
      : {
          code,
          status: form.status,
          names,
          logoUrl: form.logoUrl.trim(),
          notes: form.notes.trim() || null,
        };
    try {
      await requestEnvelope(
        editing
          ? `/api/admin/ip-commerce/publishers/${encodeURIComponent(form.id!)}`
          : "/api/admin/ip-commerce/publishers",
        {
          method: editing ? "PATCH" : "POST",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!operation.current()) return;
      setDialogOpen(false);
      setForm(emptyForm());
      try {
        const next = await requestEnvelope<AdminIpPublishersData>(
          "/api/admin/ip-commerce/publishers",
          { signal: operation.signal }
        );
        if (operation.current()) setPublishers(next);
      } catch (err) {
        if (operation.current()) setError(toErrorMessage(err));
      }
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  const columns: ColumnDef<IpPublisherRow, unknown>[] = [
    {
      id: "logo",
      header: "Logo",
      cell: ({ row }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.original.logoUrl}
          alt=""
          className="h-10 w-16 rounded-md object-contain bg-slate-50 p-1"
        />
      ),
    },
    {
      id: "name",
      header: "名称",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-950">{row.original.name}</p>
          <p className="truncate text-[12px] text-slate-500">{row.original.code}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "状态",
      cell: ({ row }) => (
        <StatusPill tone={row.original.status === "active" ? "success" : "muted"}>
          {row.original.status === "active" ? "启用" : "停用"}
        </StatusPill>
      ),
    },
    {
      id: "assignments",
      header: "已绑 IP",
      cell: ({ row }) => row.original.assignmentCount,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row.original)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="发行商库"
        description="维护芒果、优酷、Netflix 等合作发行方；在作品库里绑定到具体 IP。"
      >
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            <IconRefresh className="size-3.5" />
            刷新
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <IconPlus className="size-3.5" />
            新建发行商
          </Button>
        </div>
      </PageHeader>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="发行商" value={metrics.total} />
        <Metric label="启用中" value={metrics.active} />
        <Metric label="绑定次数" value={metrics.linked} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称或 code"
          className="sm:max-w-xs"
        />
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">启用</SelectItem>
            <SelectItem value="inactive">停用</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filtered} emptyLabel="暂无发行商。" loading={loading} />

      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (loading || logoUploading) return;
          setDialogOpen(next);
          if (!next) {
            setForm(emptyForm());
            setLogoError(null);
          }
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle>{editing ? "编辑发行商" : "新建发行商"}</DialogTitle>
            <DialogDescription className="text-[13px] text-slate-500">
              {editing
                ? "更新展示名称、Logo 或启用状态。Code 创建后不可修改。"
                : "上传 Logo，并填写简体 / 英文 / 繁体名称。Code 将按英文名自动生成。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-5 py-5">
            {/* Logo dropzone */}
            <div className="space-y-2">
              <FormLabel required>Logo</FormLabel>
              <label
                className={cn(
                  "group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 transition hover:border-slate-400 hover:bg-slate-50",
                  form.logoUrl && "border-solid border-slate-200 bg-white py-4",
                  (logoUploading || loading) && "pointer-events-none opacity-60"
                )}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={logoUploading || loading}
                  onChange={handleLogoFile}
                />
                {form.logoUrl ? (
                  <div className="flex w-full items-center gap-4">
                    <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.logoUrl} alt="" className="size-full object-contain p-1.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-800">已上传 Logo</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        点击更换 · PNG / JPG / WebP
                      </p>
                    </div>
                    <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-700 shadow-sm">
                      {logoUploading ? (
                        <IconLoader2 className="size-3.5 animate-spin" />
                      ) : (
                        <IconUpload className="size-3.5" />
                      )}
                      替换
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm">
                      {logoUploading ? (
                        <IconLoader2 className="size-5 animate-spin" />
                      ) : (
                        <IconPhoto className="size-5" />
                      )}
                    </span>
                    <div className="text-center">
                      <p className="text-[13px] font-medium text-slate-700">
                        {logoUploading ? "上传中…" : "点击上传 Logo"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        PNG / JPG / WebP · 建议透明底方形
                      </p>
                    </div>
                  </>
                )}
              </label>
              {logoError ? <p className="text-[12px] text-red-600">{logoError}</p> : null}
            </div>

            {/* Identity */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <FormLabel>状态</FormLabel>
                <StatusSegment
                  value={form.status}
                  disabled={loading}
                  onChange={(status) => setForm((current) => ({ ...current, status }))}
                />
              </div>

              {editing ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Code
                  </p>
                  <p className="mt-0.5 font-mono text-[13px] text-slate-800">{form.code}</p>
                </div>
              ) : form.enUS.trim() ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2">
                  <p className="text-[11px] text-slate-400">
                    Code 将生成为{" "}
                    <span className="font-mono text-slate-700">
                      {codeFromEnglishName(form.enUS) ?? "—"}
                    </span>
                  </p>
                </div>
              ) : null}
            </div>

            {/* Localized names */}
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                展示名称
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block space-y-1.5">
                  <FormLabel required>简体中文</FormLabel>
                  <Input
                    value={form.zhCN}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, zhCN: event.target.value }))
                    }
                    placeholder="芒果 TV"
                    disabled={loading}
                    className="h-9"
                  />
                </label>
                <label className="block space-y-1.5">
                  <FormLabel required>English</FormLabel>
                  <Input
                    value={form.enUS}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, enUS: event.target.value }))
                    }
                    placeholder="Mango TV"
                    disabled={loading}
                    className="h-9"
                  />
                </label>
                <label className="block space-y-1.5">
                  <FormLabel required>繁體中文</FormLabel>
                  <Input
                    value={form.zhHK}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, zhHK: event.target.value }))
                    }
                    placeholder="芒果 TV"
                    disabled={loading}
                    className="h-9"
                  />
                </label>
              </div>
              {!editing && form.enUS.trim() && !codeFromEnglishName(form.enUS) ? (
                <p className="text-[11px] text-amber-700">
                  英文名需包含字母，才能生成 code（如 Mango TV → mango_tv）。
                </p>
              ) : null}
            </div>

            {/* Notes */}
            <label className="block space-y-1.5">
              <FormLabel optional>备注</FormLabel>
              <Textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                rows={2}
                disabled={loading}
                placeholder="仅后台可见"
                className="resize-none text-[13px]"
              />
            </label>
          </div>

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-slate-200 bg-slate-50/80 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={loading || logoUploading}
            >
              取消
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
              {loading ? (
                <>
                  <IconLoader2 className="size-3.5 animate-spin" />
                  {editing ? "保存中…" : "创建中…"}
                </>
              ) : editing ? (
                "保存"
              ) : (
                "创建"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
