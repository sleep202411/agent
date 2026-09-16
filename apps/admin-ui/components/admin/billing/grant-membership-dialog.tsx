"use client";

// GrantMembershipDialog — 给用户或团队工作区手动开通会员（complimentary grant）。
// 个人入口先按手机号 / 邮箱解析用户；团队入口由工作区抽屉传入明确的 workspace。
//
// 用户解析走 legacy 桥的查人接口（手机号 / 邮箱 → userId）；发放调
// POST /billing/membership-grants（服务端包 grantComplimentary：同档叠加顺延、
// endsAt 到期自动回落，不涉及订单和钱）。对话框同时列出该用户现有 grant，
// admin 手动发的可提前收回；购买所得的只读（退款流程处理）。

import { useEffect, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { IconCircleCheckFilled, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  Select,
  TextInput,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import type { AdminWorkspaceRow } from "./types";

interface LegacyUser {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
}

interface MembershipGrant {
  id: string;
  subjectType: "user" | "workspace";
  subjectId: string;
  planKey: string;
  sourceType: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  note: string | null;
  effectiveStatus: "pending" | "active" | "expired" | "revoked";
}

interface GrantablePlan {
  planKey: string;
  name: string;
  benefits: { concurrentJobs?: number | null } | null;
}

// 档位与并发数一律从 active billing_membership_plans 行读，前端不写死：写死的
// 列表跟计划表漂移过（历史上留过 creator / studio 这些早已下线的档位）。服务端
// 现在按同一批计划行校验发放（没有 active 行就 MEMBERSHIP_PLAN_NOT_GRANTABLE），
// 所以这里列出来的一定发得出去。
const PERSONAL_PLANS_URL =
  "/api/admin/billing/membership-plans?productType=membership_plan&subjectType=user&status=active";
const TEAM_PLANS_URL =
  "/api/admin/billing/membership-plans?productType=team_membership_plan&subjectType=workspace&status=active";

const DURATION_PRESETS = [7, 30, 90] as const;

const GRANT_STATUS_LABEL: Record<MembershipGrant["effectiveStatus"], string> = {
  pending: "待生效",
  active: "生效中",
  expired: "已过期",
  revoked: "已收回",
};

const SOURCE_LABEL: Record<string, string> = {
  admin_manual: "后台发放",
  billing_order: "购买",
  referral_reward: "推荐奖励",
};

type GrantMembershipDialogProps = {
  open: boolean;
  initialIdentifier?: string;
  workspace?: AdminWorkspaceRow;
  onClose: () => void;
  onGranted?: () => void;
};

export function GrantMembershipDialog(props: GrantMembershipDialogProps) {
  if (!props.open) return null;
  return (
    <GrantMembershipDialogContent
      key={JSON.stringify([props.workspace?.id, props.initialIdentifier])}
      {...props}
    />
  );
}

function GrantMembershipDialogContent({
  open,
  initialIdentifier,
  workspace,
  onClose,
  onGranted,
}: GrantMembershipDialogProps) {
  const [identifier, setIdentifier] = useState(initialIdentifier?.trim() ?? "");
  const [planKey, setPlanKey] = useState("");
  const [days, setDays] = useState("30");
  const [note, setNote] = useState("");

  const [user, setUser] = useState<LegacyUser | null>(null);
  const [plans, setPlans] = useState<GrantablePlan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [grants, setGrants] = useState<MembershipGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [looking, setLooking] = useState(false);
  const { busy: submitting, begin } = useAdminOperation();
  const { busy: plansLoading, begin: beginPlans } = useAdminOperation();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<MembershipGrant | null>(null);

  const subject = workspace
    ? ({ subjectType: "workspace", subjectId: workspace.id } as const)
    : user
      ? ({ subjectType: "user", subjectId: user.userId } as const)
      : null;

  const parsedDays = Number(days);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 366;
  const canLookup = Boolean(identifier.trim()) && !looking && !submitting;
  const canSubmit =
    Boolean(subject) &&
    Boolean(planKey) &&
    daysValid &&
    Boolean(note.trim()) &&
    !grantsLoading &&
    !grantsError &&
    !plansLoading &&
    !plansError &&
    !submitting;

  useEffect(() => {
    const prefilled = initialIdentifier?.trim() ?? "";
    // 每次打开都重读：admin 刚上线/下线一个档位就该立刻反映出来。
    void loadPlans();
    if (workspace) {
      void loadGrants({ subjectType: "workspace", subjectId: workspace.id });
    } else if (prefilled) {
      void lookup(prefilled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdentifier, workspace]);

  async function loadPlans() {
    const operation = beginPlans("read");
    if (!operation) return;
    setPlansError(null);
    try {
      const data = await requestEnvelope<{ items: GrantablePlan[] }>(
        workspace ? TEAM_PLANS_URL : PERSONAL_PLANS_URL,
        operation.signal
      );
      if (!operation.current()) return;
      const items = data?.items ?? [];
      setPlans(items);
      setPlanKey((current) =>
        items.some((plan) => plan.planKey === current) ? current : (items.at(-1)?.planKey ?? "")
      );
    } catch (err) {
      if (operation.current()) setPlansError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  const readGrants = (
    target: { subjectType: "user" | "workspace"; subjectId: string },
    signal: AbortSignal
  ) =>
    requestEnvelope<MembershipGrant[]>(
      `/api/admin/billing/membership-grants?subjectType=${target.subjectType}&subjectId=${encodeURIComponent(target.subjectId)}`,
      signal
    );
  async function loadGrants(target: { subjectType: "user" | "workspace"; subjectId: string }) {
    const operation = begin("read");
    if (!operation) return;
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const rows = await readGrants(target, operation.signal);
      if (operation.current()) setGrants(rows ?? []);
    } catch (err) {
      if (operation.current()) setGrantsError(toErrorMessage(err));
    } finally {
      if (operation.current()) setGrantsLoading(false);
      operation.finish();
    }
  }
  async function lookup(idArg?: string) {
    const id = (idArg ?? identifier).trim();
    if (!id) return;
    const operation = begin("read");
    if (!operation) return;
    setLooking(true);
    setError(null);
    setGrantsError(null);
    setUser(null);
    setLookupDone(false);
    setGrants([]);
    setGranted(null);
    try {
      const u = await requestEnvelope<LegacyUser | null>(
        `/api/admin/legacy-points/users/${encodeURIComponent(id)}`,
        operation.signal
      );
      if (!operation.current()) return;
      setUser(u);
      setLookupDone(true);
      if (u) {
        setGrantsLoading(true);
        try {
          const rows = await readGrants(
            { subjectType: "user", subjectId: u.userId },
            operation.signal
          );
          if (operation.current()) setGrants(rows ?? []);
        } catch (err) {
          if (operation.current()) setGrantsError(toErrorMessage(err));
        }
      }
    } catch (err) {
      if (operation.current()) {
        setError(toErrorMessage(err));
        setUser(null);
        setLookupDone(true);
      }
    } finally {
      if (operation.current()) {
        setLooking(false);
        setGrantsLoading(false);
      }
      operation.finish();
    }
  }
  async function submit() {
    if (!canSubmit || !subject) return;
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      const grant = await mutateEnvelope<MembershipGrant>(
        "/api/admin/billing/membership-grants",
        { ...subject, planKey, durationDays: parsedDays, note: note.trim() },
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      setGranted(grant);
      setNote("");
      try {
        const rows = await readGrants(subject, operation.signal);
        if (operation.current()) {
          setGrants(rows ?? []);
          setGrantsError(null);
        }
      } catch (err) {
        if (operation.current()) setGrantsError(toErrorMessage(err));
      }
      if (operation.current()) onGranted?.();
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  async function revoke(grantId: string) {
    if (!subject) return;
    const operation = begin();
    if (!operation) return;
    setRevokingId(grantId);
    setError(null);
    try {
      await mutateEnvelope<MembershipGrant>(
        `/api/admin/billing/membership-grants/${grantId}/revoke`,
        {},
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      try {
        const rows = await readGrants(subject, operation.signal);
        if (operation.current()) {
          setGrants(rows ?? []);
          setGrantsError(null);
        }
      } catch (err) {
        if (operation.current()) setGrantsError(toErrorMessage(err));
      }
      if (operation.current()) onGranted?.();
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setRevokingId(null);
      operation.finish();
    }
  }

  function grantAgain() {
    if (submitting) return;
    setGranted(null);
    setNote("");
    setError(null);
  }

  // 历史 grant 可能挂在已下线的 key 上，查不到就原样显示 key。
  const planLabel = (key: string) => plans.find((p) => p.planKey === key)?.name ?? key;

  const planOptionLabel = (plan: GrantablePlan) => {
    const concurrency = plan.benefits?.concurrentJobs;
    const suffix = concurrency == null ? "并发不限" : `并发 ${concurrency}`;
    return `${plan.planKey} — ${plan.name}（${suffix}）`;
  };

  return (
    <AdminDialog
      open={open}
      title={workspace ? "发放 Team Plan" : "开通个人会员"}
      description={
        workspace
          ? `为团队工作区「${workspace.name}」发放限时 Team Plan（不涉及订单与扣款）。同档再次发放自动顺延，到期自动回落。`
          : "按手机号或邮箱解析用户，发放限时个人会员（不涉及订单与扣款）。同档再次发放自动顺延，到期自动回落。"
      }
      onClose={onClose}
      footer={
        granted ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={grantAgain}
            >
              再发一笔
            </Button>
            <Button type="button" size="sm" onClick={onClose}>
              完成
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? "提交中" : workspace ? "发放 Team Plan" : "开通个人会员"}
            </Button>
          </>
        )
      }
    >
      {granted ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <IconCircleCheckFilled className="size-12 text-emerald-500" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-950">开通成功</h3>
            <p className="text-[13px] text-slate-500">
              {workspace
                ? `${workspace.name} · ${workspace.id}`
                : `${user?.nickName ? `${user.nickName} · ` : ""}ID ${user?.userId}`}
            </p>
          </div>
          <div className="w-full divide-y divide-slate-100 rounded-lg border border-slate-200 text-[13px]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">档位</span>
              <span className="font-semibold text-slate-950">{planLabel(granted.planKey)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">生效</span>
              <span className="font-medium text-slate-950">{formatDate(granted.startsAt)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">到期</span>
              <span className="font-medium text-slate-950">
                {granted.endsAt ? formatDate(granted.endsAt) : "—"}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div inert={submitting} className="space-y-4">
          {workspace ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
              <span>
                团队工作区 <span className="font-medium text-slate-950">{workspace.name}</span>
              </span>
              <span className="font-mono text-[11px]">{workspace.id}</span>
              <span>成员 {workspace.memberCount}</span>
              <span>所有者 UID {workspace.ownerUserId}</span>
            </div>
          ) : (
            <>
              <FormLabel label="手机号 / 邮箱">
                <div className="flex gap-2">
                  <TextInput
                    value={identifier}
                    placeholder="手机号或邮箱"
                    onChange={(event) => {
                      if (submitting) return;
                      setIdentifier(event.target.value);
                      setUser(null);
                      setGrants([]);
                      setLookupDone(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void lookup();
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canLookup}
                    onClick={() => void lookup()}
                  >
                    <IconSearch className="size-4" />
                    {looking ? "查询中" : "查询"}
                  </Button>
                </div>
              </FormLabel>

              {lookupDone && !user && !error ? (
                <p className="text-[12px] text-amber-600">未找到匹配的用户（手机号或邮箱）。</p>
              ) : null}
            </>
          )}

          {!workspace && user ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
              <span>
                用户 <span className="font-medium text-slate-950">{user.nickName || "—"}</span>
              </span>
              <span>ID {user.userId}</span>
              {user.phone ? <span>手机 {user.phone}</span> : null}
              {user.email ? <span>邮箱 {user.email}</span> : null}
            </div>
          ) : null}

          {subject && grantsLoading ? (
            <p className="text-[12px] text-slate-400">正在读取现有会员记录…</p>
          ) : null}

          {grantsError ? <ErrorBanner message={`现有会员记录读取失败：${grantsError}`} /> : null}

          {subject && !grantsLoading && !grantsError && grants.length > 0 ? (
            <div className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-2 text-[12px] font-medium text-slate-500">
                {workspace ? "现有 Team Plan 记录" : "现有个人会员记录"}
              </div>
              <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
                {grants.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 px-4 py-2 text-[12px] text-slate-600"
                  >
                    <span className="font-medium text-slate-950">{planLabel(g.planKey)}</span>
                    <span
                      className={
                        g.effectiveStatus === "active"
                          ? "font-medium text-emerald-600"
                          : "text-slate-400"
                      }
                    >
                      {GRANT_STATUS_LABEL[g.effectiveStatus]}
                    </span>
                    <span>{SOURCE_LABEL[g.sourceType] ?? g.sourceType}</span>
                    <span className="ml-auto text-slate-400">
                      {formatDate(g.startsAt)} → {g.endsAt ? formatDate(g.endsAt) : "长期"}
                    </span>
                    {(g.effectiveStatus === "active" || g.effectiveStatus === "pending") &&
                    g.sourceType === "admin_manual" ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={submitting}
                        onClick={() => void revoke(g.id)}
                      >
                        {revokingId === g.id
                          ? g.effectiveStatus === "pending"
                            ? "取消中"
                            : "收回中"
                          : g.effectiveStatus === "pending"
                            ? "取消"
                            : "收回"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <FormLabel label="会员档位" help="档位决定并发任务数、每日配额与队列优先级。">
            <Select value={planKey} onChange={setPlanKey}>
              {plans.map((p) => (
                <option key={p.planKey} value={p.planKey}>
                  {planOptionLabel(p)}
                </option>
              ))}
            </Select>
          </FormLabel>

          {plansError ? <ErrorBanner message={plansError} /> : null}
          {!plansError && plans.length === 0 ? (
            <p className="text-[12px] text-amber-600">
              没有可发放的档位：billing_membership_plans 里没有 active 的
              {workspace ? " Team Plan" : "个人会员"}计划行。
            </p>
          ) : null}

          <FormLabel label="时长（天）" help="到期自动回落原档位，无需手动回收。">
            <div className="flex items-center gap-2">
              <TextInput
                value={days}
                inputMode="numeric"
                placeholder="例如 30"
                className="max-w-28"
                onChange={(event) => setDays(event.target.value)}
              />
              {DURATION_PRESETS.map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="xs"
                  variant={String(d) === days ? "default" : "outline"}
                  onClick={() => setDays(String(d))}
                >
                  {d} 天
                </Button>
              ))}
            </div>
          </FormLabel>

          <FormLabel label="审计备注" help="必填；写入 grant metadata 与审计日志。">
            <TextInput
              value={note}
              placeholder="例如 临时提高并发、客服补偿"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormLabel>

          {error ? <ErrorBanner message={error} /> : null}
        </div>
      )}
    </AdminDialog>
  );
}
