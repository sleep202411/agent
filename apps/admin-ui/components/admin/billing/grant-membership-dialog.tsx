"use client";

// GrantMembershipDialog — 给用户手动开通会员（complimentary grant），装在 AdminDialog 里。
// 由用户列表的「开通会员」按钮共用（头部空标识符、行内预填该用户）。
//
// 用户解析走 legacy 桥的查人接口（手机号 / 邮箱 → userId）；发放调
// POST /billing/membership-grants（服务端包 grantComplimentary：同档叠加顺延、
// endsAt 到期自动回落，不涉及订单和钱）。对话框同时列出该用户现有 grant，
// admin 手动发的可提前收回；购买所得的只读（退款流程处理）。

import { useEffect, useState } from "react";
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

interface LegacyUser {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  scoreBalance: number;
  userLevel: string | null;
}

interface MembershipGrant {
  id: string;
  planKey: string;
  status: "pending" | "active" | "expired" | "revoked";
  sourceType: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  note: string | null;
  activeNow: boolean;
}

// 与服务端 ADMIN_GRANTABLE_PLAN_KEYS 一致；并发数来自 entitlement PLAN_CONFIG，
// 写在标签里帮 admin 按需选档。
const PLAN_OPTIONS = [
  { key: "basic", label: "basic — 基础版（并发 1）" },
  { key: "creator", label: "creator — 创作者版（并发 1）" },
  { key: "standard", label: "standard — 标准版（并发 2）" },
  { key: "pro", label: "pro — 专业版（并发 3）" },
  { key: "studio", label: "studio — 工作室版（并发 5）" },
] as const;

const DURATION_PRESETS = [7, 30, 90] as const;

const GRANT_STATUS_LABEL: Record<MembershipGrant["status"], string> = {
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

export function GrantMembershipDialog({
  open,
  initialIdentifier,
  onClose,
  onGranted,
}: {
  open: boolean;
  initialIdentifier?: string;
  onClose: () => void;
  onGranted?: () => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [planKey, setPlanKey] = useState<string>("studio");
  const [days, setDays] = useState("30");
  const [note, setNote] = useState("");

  const [user, setUser] = useState<LegacyUser | null>(null);
  const [grants, setGrants] = useState<MembershipGrant[]>([]);
  const [lookupDone, setLookupDone] = useState(false);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<MembershipGrant | null>(null);

  const parsedDays = Number(days);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 366;
  const canLookup = Boolean(identifier.trim()) && !looking;
  const canSubmit = Boolean(user) && daysValid && Boolean(note.trim()) && !submitting;

  useEffect(() => {
    if (!open) {
      setIdentifier("");
      setPlanKey("studio");
      setDays("30");
      setNote("");
      setUser(null);
      setGrants([]);
      setLookupDone(false);
      setError(null);
      setGranted(null);
      return;
    }
    const prefilled = initialIdentifier?.trim() ?? "";
    setIdentifier(prefilled);
    setPlanKey("studio");
    setDays("30");
    setNote("");
    setUser(null);
    setGrants([]);
    setLookupDone(false);
    setError(null);
    setGranted(null);
    if (prefilled) void lookup(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIdentifier]);

  async function loadGrants(userId: string) {
    // Best-effort — a listing failure must not block the grant flow.
    try {
      const rows = await requestEnvelope<MembershipGrant[]>(
        `/api/admin/billing/membership-grants?userId=${encodeURIComponent(userId)}`
      );
      setGrants(rows ?? []);
    } catch {
      setGrants([]);
    }
  }

  async function lookup(idArg?: string) {
    const id = (idArg ?? identifier).trim();
    if (!id) return;
    setLooking(true);
    setError(null);
    setGranted(null);
    try {
      const u = await requestEnvelope<LegacyUser | null>(
        `/api/admin/legacy-points/users/${encodeURIComponent(id)}`
      );
      setUser(u);
      setLookupDone(true);
      setGrants([]);
      if (u) await loadGrants(u.userId);
    } catch (err) {
      setError(toErrorMessage(err));
      setUser(null);
      setLookupDone(true);
    } finally {
      setLooking(false);
    }
  }

  async function submit() {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    setError(null);
    try {
      const grant = await mutateEnvelope<MembershipGrant>("/api/admin/billing/membership-grants", {
        userId: user.userId,
        planKey,
        durationDays: parsedDays,
        note: note.trim(),
      });
      setGranted(grant);
      setNote("");
      await loadGrants(user.userId);
      onGranted?.();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(grantId: string) {
    if (!user || revokingId) return;
    setRevokingId(grantId);
    setError(null);
    try {
      await mutateEnvelope<MembershipGrant>(
        `/api/admin/billing/membership-grants/${grantId}/revoke`,
        {}
      );
      await loadGrants(user.userId);
      onGranted?.();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setRevokingId(null);
    }
  }

  function grantAgain() {
    setGranted(null);
    setNote("");
    setError(null);
  }

  const planLabel = (key: string) =>
    PLAN_OPTIONS.find((p) => p.key === key)?.label.split(" — ")[0] ?? key;

  return (
    <AdminDialog
      open={open}
      title="开通会员"
      description="按手机号或邮箱解析用户，发放限时会员（不涉及订单与扣款）。同档再次发放自动顺延，到期自动回落。"
      onClose={onClose}
      footer={
        granted ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={grantAgain}>
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
              {submitting ? "提交中" : "开通会员"}
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
              {user?.nickName ? `${user.nickName} · ` : ""}ID {user?.userId}
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
        <div className="space-y-4">
          <FormLabel label="手机号 / 邮箱">
            <div className="flex gap-2">
              <TextInput
                value={identifier}
                placeholder="手机号或邮箱"
                onChange={(event) => setIdentifier(event.target.value)}
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

          {user ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
              <span>
                用户 <span className="font-medium text-slate-950">{user.nickName || "—"}</span>
              </span>
              <span>ID {user.userId}</span>
              {user.phone ? <span>手机 {user.phone}</span> : null}
              {user.email ? <span>邮箱 {user.email}</span> : null}
            </div>
          ) : null}

          {user && grants.length > 0 ? (
            <div className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-2 text-[12px] font-medium text-slate-500">
                现有会员记录
              </div>
              <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
                {grants.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 px-4 py-2 text-[12px] text-slate-600"
                  >
                    <span className="font-medium text-slate-950">{planLabel(g.planKey)}</span>
                    <span
                      className={g.activeNow ? "font-medium text-emerald-600" : "text-slate-400"}
                    >
                      {g.activeNow ? "生效中" : GRANT_STATUS_LABEL[g.status]}
                    </span>
                    <span>{SOURCE_LABEL[g.sourceType] ?? g.sourceType}</span>
                    <span className="ml-auto text-slate-400">
                      {formatDate(g.startsAt)} → {g.endsAt ? formatDate(g.endsAt) : "长期"}
                    </span>
                    {g.activeNow && g.sourceType === "admin_manual" ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={revokingId === g.id}
                        onClick={() => void revoke(g.id)}
                      >
                        {revokingId === g.id ? "收回中" : "收回"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <FormLabel label="会员档位" help="档位决定并发任务数、每日配额与队列优先级。">
            <Select value={planKey} onChange={setPlanKey}>
              {PLAN_OPTIONS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </FormLabel>

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
