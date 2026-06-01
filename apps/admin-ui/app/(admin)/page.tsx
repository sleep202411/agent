import Link from "next/link";
import { IconAlertTriangle, IconArrowRight, IconChecks, IconClockHour4 } from "@tabler/icons-react";

import { PageHeader } from "@/components/admin/page-header";
import { ErrorBanner, Metric, formatDate, statusLabel } from "@/components/admin/ip/shared";
import { fetchAdminIpOverview } from "@/lib/admin-ip-commerce";
import { fetchAdminBillingOverview } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function AdminHomePage() {
  const [session, ip, billing] = await Promise.all([
    getAdminSession(),
    fetchAdminIpOverview(),
    fetchAdminBillingOverview(),
  ]);

  const ipMetrics = ip.data?.metrics;
  const billingMetrics = billing.error ? null : (billing.data?.metrics ?? null);
  const reviewQueue = ip.data?.reviewQueue ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          session ? (
            <>
              {session.site.label} · {session.site.databaseLabel}
            </>
          ) : undefined
        }
        title="运营总览"
        description="内容审核、IP 商业化和计费财务的核心运营指标，数据来自当前站点后台数据库。"
      />

      {/* IP / content metrics — real data from the IP overview endpoint */}
      {ip.error ? (
        <ErrorBanner message={ip.error} />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="待审核 IP" value={ipMetrics?.pendingReviewIps ?? 0} tone="warn" />
          <Metric label="开放举报" value={ipMetrics?.openReports ?? 0} tone="risk" />
          <Metric label="已发布 IP" value={ipMetrics?.publishedIps ?? 0} />
          <Metric label="近 7 日 IP 订单" value={ipMetrics?.ordersLast7Days ?? 0} />
        </section>
      )}

      {/* Billing metrics — only when the viewer can read billing (else omitted) */}
      {billingMetrics ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="待处理订单" value={billingMetrics.pendingOrders} tone="warn" />
          <Metric label="近 7 日完成订单" value={billingMetrics.fulfilledOrders7d} />
          <Metric label="近 7 日支付失败" value={billingMetrics.paymentFailures7d} tone="risk" />
          <Metric
            label="渠道绑定待完善"
            value={billingMetrics.incompleteProviderBindings}
            tone={billingMetrics.incompleteProviderBindings > 0 ? "warn" : "default"}
          />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950">待审核队列</h3>
            <Link
              href="/ip/reviews"
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
            >
              进入审核
              <IconArrowRight className="size-3" />
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {reviewQueue.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-8 text-center text-[13px] text-slate-500">
                {ip.error ? "无法加载审核队列。" : "暂无待审核内容。"}
              </div>
            ) : (
              reviewQueue.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  href="/ip/reviews"
                  className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3 transition hover:border-slate-200 hover:bg-slate-50"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-white text-slate-500">
                    <IconClockHour4 className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-medium text-slate-950">
                        {item.ip?.title ?? item.targetId}
                      </p>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[12px] leading-5 text-slate-500">
                      {item.changeSummary ?? "提交于"} · {formatDate(item.submittedAt)}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">生产级基线</h3>
          <div className="mt-4 space-y-3 text-[13px] text-slate-600">
            <p className="flex gap-2">
              <IconChecks className="mt-0.5 size-4 text-emerald-600" />
              权限不复用 Java 普通用户会话。
            </p>
            <p className="flex gap-2">
              <IconChecks className="mt-0.5 size-4 text-emerald-600" />
              角色、权限和后台会话由 Postgres 独立管理。
            </p>
            <p className="flex gap-2">
              <IconAlertTriangle className="mt-0.5 size-4 text-amber-600" />
              所有敏感操作写入审计日志，可在系统审计中追溯。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
