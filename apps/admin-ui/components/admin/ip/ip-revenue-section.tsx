"use client";

import { useEffect, useState } from "react";
import { IconCoin, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchIpRevenueConfig, updateIpRevenueConfig } from "@/lib/admin-ip-commerce-client";
import { ErrorBanner, formatShareBps, StatusPill, toErrorMessage } from "./shared";
import type { IpRevenueConfigData, IpRevenueContributor } from "./types";

type ContributorDraft = {
  id: string;
  revenueEligible: boolean;
  // raw percent text in the input; "" means inherit/none
  sharePercent: string;
};

function bpsToPercentText(bps: number | null) {
  return bps === null ? "" : String(bps / 100);
}

function percentTextToBps(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const percent = Number(trimmed);
  if (Number.isNaN(percent)) return null;
  return Math.round(percent * 100);
}

function contributorLabel(contributor: IpRevenueContributor) {
  return (
    contributor.displayName ||
    contributor.customRole ||
    contributor.role ||
    contributor.userId ||
    contributor.id
  );
}

export function IpRevenueSection({ ipId, locale }: { ipId: string; locale?: string }) {
  const [config, setConfig] = useState<IpRevenueConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drafts.
  const [overridePercent, setOverridePercent] = useState("");
  const [contributorDrafts, setContributorDrafts] = useState<ContributorDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function hydrate(data: IpRevenueConfigData) {
    setConfig(data);
    setOverridePercent(bpsToPercentText(data.creatorRevenueShareBps));
    setContributorDrafts(
      data.contributors.map((contributor) => ({
        id: contributor.id,
        revenueEligible: contributor.revenueEligible,
        sharePercent: bpsToPercentText(contributor.revenueShareBps),
      }))
    );
    setSaved(false);
    setSaveError(null);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      hydrate(await fetchIpRevenueConfig(ipId, locale));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer the fetch (and its loading setState) out of the synchronous effect
    // body — matches admin-audit-panel and keeps cascading renders away.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Reload whenever the selected IP / locale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipId, locale]);

  function updateContributor(id: string, next: Partial<ContributorDraft>) {
    setContributorDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...next } : draft))
    );
    setSaved(false);
  }

  // Sum of eligible contributors' shares in bps for the client-side <=100% guard.
  const eligibleSumBps = contributorDrafts.reduce((sum, draft) => {
    if (!draft.revenueEligible) return sum;
    const bps = percentTextToBps(draft.sharePercent);
    return sum + (bps ?? 0);
  }, 0);
  const overSplit = eligibleSumBps > 10000;

  async function save() {
    if (!config || saving) return;
    const overrideBps = percentTextToBps(overridePercent);
    if (
      overridePercent.trim() !== "" &&
      (overrideBps === null || overrideBps < 0 || overrideBps > 10000)
    ) {
      setSaveError("单 IP 分成比例必须在 0% 到 100% 之间，留空表示沿用平台默认。");
      return;
    }
    if (overSplit) {
      setSaveError("参与分成的贡献者比例之和不能超过 100%。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const result = await updateIpRevenueConfig(ipId, {
        creatorRevenueShareBps: overrideBps,
        contributors: contributorDrafts.map((draft) => ({
          id: draft.id,
          revenueEligible: draft.revenueEligible,
          revenueShareBps: draft.revenueEligible ? percentTextToBps(draft.sharePercent) : null,
        })),
        expectedVersion: config.version,
      });
      hydrate(result);
      setSaved(true);
    } catch (err) {
      setSaveError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-950">创作者收益分成</h4>
        <p className="mt-2 text-sm text-slate-500">正在加载收益配置…</p>
      </section>
    );
  }

  if (error || !config) {
    return (
      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-950">创作者收益分成</h4>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <IconRefresh className="size-3.5" />
            重试
          </Button>
        </div>
        {error ? (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-950">创作者收益分成</h4>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            单 IP
            可覆盖平台默认分成；贡献者列表决定收益如何分给团队成员。收益以社区积分入账，暂不开放提现。
          </p>
        </div>
        <StatusPill tone="muted">生效 {formatShareBps(config.effectiveShareBps)}</StatusPill>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-[12px] font-medium text-slate-600">单 IP 分成（%）</span>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={overridePercent}
            onChange={(event) => {
              setOverridePercent(event.target.value);
              setSaved(false);
            }}
            placeholder={`留空沿用默认 ${formatShareBps(config.defaultShareBps)}`}
            className="h-9"
          />
          <span className="text-[11px] text-slate-500">
            留空表示沿用平台默认 {formatShareBps(config.defaultShareBps)}。
          </span>
        </label>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-slate-600">归属信息</span>
          <p className="text-[12px] text-slate-700">所属创作者：{config.ownerUserId}</p>
          <p className="text-[11px] text-slate-500">版本 v{config.version}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-slate-600">贡献者分成</span>
          <span className={cn("text-[11px]", overSplit ? "text-red-600" : "text-slate-500")}>
            参与分成合计 {formatShareBps(eligibleSumBps)} / 100%
          </span>
        </div>
        <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {contributorDrafts.length ? (
            contributorDrafts.map((draft) => {
              const contributor = config.contributors.find((item) => item.id === draft.id);
              // Only account-linked contributors can earn — an unbound name has
              // no withdrawable wallet to credit (the purchase path skips them
              // and the server rejects eligible + no account).
              const linked = Boolean(contributor?.userId);
              return (
                <div key={draft.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-950">
                      {contributor ? contributorLabel(contributor) : draft.id}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {contributor?.role ?? "-"}
                      {linked ? ` · ${contributor?.userId}` : " · 未绑定账号（不可分成）"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={draft.revenueEligible ? "default" : "outline"}
                    size="sm"
                    disabled={!linked}
                    title={linked ? undefined : "未绑定账号，无法参与分成"}
                    onClick={() =>
                      updateContributor(draft.id, { revenueEligible: !draft.revenueEligible })
                    }
                  >
                    {!linked ? "无法分成" : draft.revenueEligible ? "参与分成" : "不参与"}
                  </Button>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={draft.sharePercent}
                    onChange={(event) =>
                      updateContributor(draft.id, { sharePercent: event.target.value })
                    }
                    disabled={!linked || !draft.revenueEligible}
                    placeholder="%"
                    aria-label="贡献者分成比例"
                    className="h-9 w-24"
                  />
                </div>
              );
            })
          ) : (
            <p className="px-3 py-4 text-sm text-slate-500">该 IP 暂无登记贡献者。</p>
          )}
        </div>
      </div>

      {saveError ? <p className="mt-2 text-sm text-red-600">{saveError}</p> : null}
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? <p className="text-[12px] text-emerald-600">已保存</p> : null}
        <Button type="button" onClick={() => void save()} disabled={saving || overSplit}>
          <IconCoin className="size-3.5" />
          {saving ? "保存中…" : "保存分成配置"}
        </Button>
      </div>
    </section>
  );
}
