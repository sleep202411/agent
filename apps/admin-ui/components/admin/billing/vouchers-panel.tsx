"use client";

// 兑换券 page panel for the /billing sub-app: mint a batch of redemption codes
// and view / track redemptions. A voucher is redeemed for a DIRECT grant (today
// compute_point credits) — distinct from 促销优惠 (which discount an order).

import { useAdminOperation } from "../use-admin-operation";
import { useMemo, useState } from "react";
import { IconCopy, IconGift, IconPlus, IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  PageHeader,
  Select,
  TextInput,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  stringField,
  toErrorMessage,
} from "./shared";
import type {
  AdminBillingVouchersData,
  GenerateVouchersResult,
  VoucherRow,
  VoucherStatus,
} from "./types";

type BillingSiteKey = "global" | "cn";

const emptyVouchers: AdminBillingVouchersData = { items: [] };

const STATUS_LABEL: Record<VoucherStatus, string> = {
  active: "未使用",
  redeemed: "已核销",
  void: "已作废",
  expired: "已过期",
};

const STATUS_CLASS: Record<VoucherStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  redeemed: "bg-slate-100 text-slate-600",
  void: "bg-rose-50 text-rose-700",
  expired: "bg-amber-50 text-amber-700",
};

function VoucherStatusPill({ status }: { status: VoucherStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium",
        STATUS_CLASS[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

type BillingVouchersPanelProps = {
  siteKey: BillingSiteKey;
  siteLabel: string;
  databaseLabel: string;
  initialVouchers: AdminBillingVouchersData | null;
  initialError?: string | null;
};

export function BillingVouchersPanel(props: BillingVouchersPanelProps) {
  return <BillingVouchersView key={props.siteKey} {...props} />;
}

function BillingVouchersView({
  siteLabel,
  databaseLabel,
  initialVouchers,
  initialError,
}: BillingVouchersPanelProps) {
  const { busy: loading, begin } = useAdminOperation();
  const [vouchers, setVouchers] = useState(initialVouchers ?? emptyVouchers);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [generated, setGenerated] = useState<GenerateVouchersResult | null>(null);

  function queryString() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  async function refresh() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const data = await requestEnvelope<AdminBillingVouchersData>(
        `/api/admin/billing/vouchers${queryString()}`,
        operation.signal
      );
      if (operation.current()) setVouchers(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = begin();
    if (!operation) return;
    setError(null);
    const formEl = event.currentTarget;
    try {
      const form = new FormData(formEl);
      const computeCreditAmount = stringField(form, "computeCreditAmount");
      const expiresAt = stringField(form, "expiresAt");
      const codePrefix = stringField(form, "codePrefix");
      const result = await mutateEnvelope<GenerateVouchersResult>(
        "/api/admin/billing/vouchers",
        {
          count: Number(stringField(form, "count")),
          grantType: "compute_credits",
          computeCreditAmount: computeCreditAmount ? Number(computeCreditAmount) : undefined,
          expiresAt: expiresAt || undefined,
          codePrefix: codePrefix || undefined,
          note: stringField(form, "note") || undefined,
        },
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      formEl.reset();
      setGenerated(result);
      const data = await requestEnvelope<AdminBillingVouchersData>(
        `/api/admin/billing/vouchers${queryString()}`,
        operation.signal
      );
      if (operation.current()) setVouchers(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  const columns = useMemo<ColumnDef<VoucherRow, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "兑换码",
        cell: ({ row }) => (
          <>
            <p className="font-mono text-[12px] font-semibold text-slate-950">
              {row.original.code}
            </p>
            {row.original.note ? (
              <p className="mt-0.5 text-[12px] text-slate-500">{row.original.note}</p>
            ) : null}
          </>
        ),
      },
      {
        id: "value",
        header: "面额",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="text-sm font-semibold text-slate-950">
            {row.original.computeCreditAmount?.toLocaleString() ?? "—"} 算力积分
          </p>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <VoucherStatusPill status={row.original.status} />,
      },
      {
        id: "redeemed",
        header: "核销",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.redeemedAt ? (
            <>
              <p className="text-sm text-slate-700">{row.original.redeemedByUserId}</p>
              <p className="text-[12px] text-slate-500">{formatDate(row.original.redeemedAt)}</p>
            </>
          ) : (
            <span className="text-[12px] text-slate-400">—</span>
          ),
      },
      {
        id: "expiry",
        header: "有效期",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">
            {row.original.expiresAt ? formatDate(row.original.expiresAt) : "长期"}
          </span>
        ),
      },
      {
        id: "created",
        header: "创建",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-400">{formatDate(row.original.createdAt)}</span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="兑换券"
        description="批量生成算力积分兑换码，兑换后到账用户的默认工作区。"
      />
      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-4">
            <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_auto]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <TextInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9 pr-3"
                  placeholder="搜索兑换码"
                />
              </label>
              <Select value={status} onChange={setStatus}>
                <option value="">全部状态</option>
                <option value="active">未使用</option>
                <option value="redeemed">已核销</option>
                <option value="expired">已过期</option>
                <option value="void">已作废</option>
              </Select>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={vouchers.items}
            loading={loading}
            minWidth={920}
            pageSize={20}
            emptyLabel="暂无兑换券"
            className="rounded-none border-0"
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">批量生成兑换券</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                每个码可被一位用户核销一次，到账该用户的默认工作区。
              </p>
            </div>
            <IconGift className="size-4 text-slate-400" />
          </div>
          <form onSubmit={handleGenerate} className="mt-4 grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <FormLabel label="数量" help="本批生成的兑换码数量（1-1000）。">
                <TextInput
                  disabled={loading}
                  name="count"
                  required
                  inputMode="numeric"
                  placeholder="100"
                />
              </FormLabel>
              <FormLabel label="面额（算力积分）" help="每个码核销到账的算力积分数量。">
                <TextInput
                  disabled={loading}
                  name="computeCreditAmount"
                  required
                  inputMode="numeric"
                  placeholder="500"
                />
              </FormLabel>
            </div>
            <FormLabel label="码前缀" help="可选，默认 FIZZ。仅字母数字，便于识别活动。">
              <TextInput disabled={loading} name="codePrefix" placeholder="FIZZ" />
            </FormLabel>
            <FormLabel label="有效期" help="留空表示长期有效；过期后无法核销。">
              <TextInput disabled={loading} name="expiresAt" type="datetime-local" />
            </FormLabel>
            <FormLabel label="备注" help="内部运营备注，可选。">
              <TextInput disabled={loading} name="note" placeholder="例如：双十一活动" />
            </FormLabel>
            <Button type="submit" disabled={loading}>
              <IconPlus className="size-3.5" />
              生成
            </Button>
          </form>
        </section>
      </div>

      {generated ? (
        <GeneratedCodesDialog result={generated} onClose={() => setGenerated(null)} />
      ) : null}
    </div>
  );
}

function GeneratedCodesDialog({
  result,
  onClose,
}: {
  result: GenerateVouchersResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const codes = result.vouchers.map((v) => v.code).join("\n");

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <AdminDialog
      open
      title={`已生成 ${result.count} 个兑换码`}
      description="请立即复制保存——兑换码以明文展示，关闭后仍可在列表查询，但不会再次集中展示。"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={copyAll}>
            <IconCopy className="size-3.5" />
            {copied ? "已复制" : "复制全部"}
          </Button>
          <Button size="sm" onClick={onClose}>
            完成
          </Button>
        </>
      }
    >
      <textarea
        readOnly
        value={codes}
        className="h-64 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] leading-6 text-slate-800 focus:outline-none"
      />
    </AdminDialog>
  );
}
