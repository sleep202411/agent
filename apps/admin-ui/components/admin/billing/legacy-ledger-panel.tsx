"use client";

// 积分流水 — Java 老系统 integral_record 的只读全局账本(充值/消费/系统赠送)。
// 可按用户(手机/邮箱/昵称/ID)和类型筛选,服务端分页。数据经
// /admin/legacy-points/ledger,不经 Prisma。加/扣分动作在「用户列表」的弹窗里,
// 这里只读。

import { useCallback, useEffect, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  PageHeader,
  Select,
  TextInput,
  formatDate,
  formatSignedInteger,
  requestEnvelope,
  toErrorMessage,
} from "./shared";

interface LegacyLedgerRow {
  id: string;
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  recordType: number;
  integralChange: number | null;
  currentBalance: number | null;
  remark: string | null;
  modelCode: string | null;
  createTime: string | null;
}

interface LegacyLedgerResult {
  items: LegacyLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

const RECORD_TYPE_LABEL: Record<number, string> = {
  1: "充值",
  2: "消费",
  3: "系统赠送",
};

export function LegacyLedgerPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [recordType, setRecordType] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<LegacyLedgerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string, type: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      if (query) params.set("query", query);
      if (type) params.set("recordType", type);
      const data = await requestEnvelope<LegacyLedgerResult>(
        `/api/admin/legacy-points/ledger?${params.toString()}`
      );
      setResult(data);
    } catch (err) {
      setError(toErrorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(activeQuery, recordType, page);
  }, [load, activeQuery, recordType, page]);

  function runSearch() {
    setPage(1);
    setActiveQuery(queryInput.trim());
  }

  function changeType(next: string) {
    setPage(1);
    setRecordType(next);
  }

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <PageHeader
        title="积分流水"
        description="Java 老系统积分流水（integral_record）：充值 / 消费 / 系统赠送。仅读取，可按用户与类型筛选。"
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <div className="max-w-xs flex-1">
            <TextInput
              value={queryInput}
              placeholder="手机号 / 邮箱 / 昵称 / ID"
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
          </div>
          <div className="w-36">
            <Select value={recordType} onChange={changeType} title="类型">
              <option value="">全部类型</option>
              <option value="1">充值</option>
              <option value="2">消费</option>
              <option value="3">系统赠送</option>
            </Select>
          </div>
          <Button type="button" size="sm" disabled={loading} onClick={runSearch}>
            <IconSearch className="size-4" />
            {loading ? "查询中" : "搜索"}
          </Button>
          {total > 0 ? (
            <span className="ml-auto text-[12px] text-slate-500">共 {total} 条</span>
          ) : null}
        </div>

        {error ? (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500 [&>th]:whitespace-nowrap">
                <th className="px-4 py-2 font-medium">时间</th>
                <th className="px-4 py-2 font-medium">用户</th>
                <th className="px-4 py-2 font-medium">类型</th>
                <th className="px-4 py-2 font-medium">变动</th>
                <th className="px-4 py-2 font-medium">变动后余额</th>
                <th className="px-4 py-2 font-medium">模型</th>
                <th className="px-4 py-2 font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              {result && result.items.length > 0 ? (
                result.items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                      {r.createTime ? formatDate(r.createTime) : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      <span className="text-slate-900">{r.nickName || "—"}</span>
                      <span className="ml-1 text-[11px] text-slate-400">#{r.userId}</span>
                      <div className="text-[11px] text-slate-400">{r.phone || r.email || ""}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {RECORD_TYPE_LABEL[r.recordType] ?? r.recordType}
                    </td>
                    <td
                      className={
                        r.integralChange == null
                          ? "px-4 py-2 font-medium text-slate-600"
                          : r.integralChange < 0
                            ? "px-4 py-2 font-medium text-rose-600"
                            : "px-4 py-2 font-medium text-emerald-600"
                      }
                    >
                      {r.integralChange == null
                        ? "—"
                        : formatSignedInteger(String(r.integralChange))}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{r.currentBalance ?? "—"}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                      {r.modelCode ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      <div className="max-w-[360px] truncate" title={r.remark ?? undefined}>
                        {r.remark ?? "—"}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    {loading ? "加载中…" : "无积分流水"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-[12px] text-slate-500">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
