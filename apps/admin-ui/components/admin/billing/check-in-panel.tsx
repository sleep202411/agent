"use client";

import { useAdminOperation } from "../use-admin-operation";

// 每日签到 config page for the /billing sub-app. Single admin-editable config:
// enable/disable + the streak reward cycle (credits by consecutive-day index).

import { useState } from "react";
import { IconCalendarCheck, IconDeviceFloppy } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  FormLabel,
  PageHeader,
  Select,
  TextInput,
  formatDate,
  mutateEnvelope,
  toErrorMessage,
} from "./shared";
import type { CheckInConfigData } from "./types";

function parseRewards(input: string): number[] {
  return input
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

export function BillingCheckInPanel({
  siteLabel,
  databaseLabel,
  initialConfig,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialConfig: CheckInConfigData | null;
  initialError?: string | null;
}) {
  const [enabled, setEnabled] = useState(initialConfig?.enabled ? "on" : "off");
  const [rewardsText, setRewardsText] = useState((initialConfig?.rewards ?? []).join(", "));
  const [updatedAt, setUpdatedAt] = useState(initialConfig?.updatedAt ?? null);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saved, setSaved] = useState(false);

  const parsed = parseRewards(rewardsText);
  const valid = parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n >= 1);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError("奖励周期必须是一组正整数，例如 10,10,10,10,10,10,50");
      return;
    }
    const operation = begin();
    if (!operation) return;
    setError(null);
    setSaved(false);
    try {
      const data = await mutateEnvelope<CheckInConfigData>(
        "/api/admin/billing/check-in/config",
        { enabled: enabled === "on", rewards: parsed },
        "PATCH",
        operation.signal
      );
      if (!operation.current()) return;
      setUpdatedAt(data.updatedAt);
      setSaved(true);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="每日签到"
        description="每日签到奖励到账用户的默认工作区；连续签到按周期递增，断签重置。"
      />
      {error ? <ErrorBanner message={error} /> : null}

      <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">签到配置</h3>
            <p className="mt-1 text-[12px] text-slate-500">
              到账用户的默认工作区；每人每天一次（UTC 自然日）。
            </p>
          </div>
          <IconCalendarCheck className="size-4 text-slate-400" />
        </div>
        <form onSubmit={save} className="mt-4 grid gap-4">
          <FormLabel label="状态" help="关闭后用户无法签到。">
            <Select disabled={loading} value={enabled} onChange={setEnabled}>
              <option value="off">关闭</option>
              <option value="on">开启</option>
            </Select>
          </FormLabel>
          <FormLabel
            label="奖励周期（算力积分）"
            help="逗号分隔的一组正整数，按连续签到天数循环。例如 100,188,288,388,488,588,888 表示连续 7 天递增、第 7 天 888，之后循环。"
          >
            <TextInput
              disabled={loading}
              value={rewardsText}
              onChange={(event) => setRewardsText(event.target.value)}
              placeholder="100,188,288,388,488,588,888"
            />
          </FormLabel>
          {parsed.length ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
              预览：{parsed.map((n, i) => `第${i + 1}天 ${n}`).join(" · ")}
              {!valid ? <span className="text-rose-600">（含非正整数）</span> : null}
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading || !valid}>
              <IconDeviceFloppy className="size-3.5" />
              保存
            </Button>
            {saved ? <span className="text-[12px] text-emerald-600">已保存</span> : null}
            {updatedAt ? (
              <span className="text-[12px] text-slate-400">更新于 {formatDate(updatedAt)}</span>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
