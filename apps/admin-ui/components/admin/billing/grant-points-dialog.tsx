"use client";

// GrantPointsDialog — 给用户加 / 扣 **算力积分（compute_point）**，装在 AdminDialog 里。
// 由用户列表的「加积分」按钮共用（头部空标识符、行内预填该用户）。
//
// 用户解析仍走 legacy 桥的查人接口（仅把手机号 / 邮箱解析成 userId + 显示加给谁）；实际
// 加 / 扣调新的 compute_point 接口 POST /billing/wallets/user-credits（amount 为正数加分、
// 负数扣分，服务端按 admin_adjustment 落到该用户个人 workspace 的算力池）。即时生效、写审计。
// 单位是积分（1:1，不是金额）。

import { useEffect, useState } from "react";
import { IconCircleCheckFilled, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  TextInput,
  formatSignedInteger,
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
}

// POST /billing/wallets/user-credits → admin wallet account detail. We only read
// the resulting available balance, tolerant of the exact envelope nesting.
interface CreditResponse {
  account?: { availableBalance?: string };
  availableBalance?: string;
}

export interface GrantResult {
  userId: string;
  delta: number;
  /** New compute_point balance after the op, when the response surfaced it. */
  newBalance: string | null;
}

export function GrantPointsDialog({
  open,
  initialIdentifier,
  onClose,
  onGranted,
}: {
  open: boolean;
  initialIdentifier?: string;
  onClose: () => void;
  onGranted?: (result: GrantResult) => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");

  const [user, setUser] = useState<LegacyUser | null>(null);
  // Current compute_point balance for the resolved user (the thing this dialog
  // grants). Read-only — fetched on lookup, refreshed after a grant.
  const [balance, setBalance] = useState<string | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GrantResult | null>(null);

  const parsedScore = Number(score);
  const scoreValid = Number.isInteger(parsedScore) && parsedScore !== 0;
  const canLookup = Boolean(identifier.trim()) && !looking;
  // The compute_point API takes a userId (resolve first) and requires a reason
  // for the audit trail.
  const canSubmit = Boolean(user) && scoreValid && Boolean(note.trim()) && !submitting;

  const resetKey = `${open}:${initialIdentifier ?? ""}`;
  const [previousResetKey, setPreviousResetKey] = useState<string | null>(null);
  if (resetKey !== previousResetKey) {
    setPreviousResetKey(resetKey);
    setIdentifier(open ? (initialIdentifier?.trim() ?? "") : "");
    setScore("");
    setNote("");
    setUser(null);
    setLookupDone(false);
    setError(null);
    setResult(null);
    setBalance(null);
    setLooking(Boolean(open && initialIdentifier?.trim()));
  }

  useEffect(() => {
    if (!open || !initialIdentifier?.trim()) return;
    let cancelled = false;
    const id = initialIdentifier.trim();
    void requestEnvelope<LegacyUser | null>(
      `/api/admin/legacy-points/users/${encodeURIComponent(id)}`
    )
      .then(async (next) => {
        if (cancelled) return;
        setUser(next);
        setLookupDone(true);
        if (next) {
          try {
            const balance = await requestEnvelope<{ availableBalance: string }>(
              `/api/admin/billing/wallets/user-credits?userId=${encodeURIComponent(next.userId)}&idFormat=raw`
            );
            if (!cancelled) setBalance(balance?.availableBalance ?? null);
          } catch {
            if (!cancelled) setBalance(null);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(toErrorMessage(err));
          setLookupDone(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLooking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialIdentifier]);

  async function lookup(idArg?: string) {
    const id = (idArg ?? identifier).trim();
    if (!id) return;
    setLooking(true);
    setError(null);
    setResult(null);
    setBalance(null);
    try {
      const u = await requestEnvelope<LegacyUser | null>(
        `/api/admin/legacy-points/users/${encodeURIComponent(id)}`
      );
      setUser(u);
      setLookupDone(true);
      if (u) {
        // Best-effort current-balance read; a failure here must NOT block the
        // grant flow (the user is already resolved), so swallow it.
        try {
          const bal = await requestEnvelope<{ availableBalance: string }>(
            `/api/admin/billing/wallets/user-credits?userId=${encodeURIComponent(u.userId)}&idFormat=raw`
          );
          setBalance(bal?.availableBalance ?? null);
        } catch {
          setBalance(null);
        }
      }
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
      const data = await mutateEnvelope<CreditResponse>("/api/admin/billing/wallets/user-credits", {
        userId: user.userId,
        idFormat: "raw",
        amount: parsedScore,
        reason: note.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      const newBalance = data?.account?.availableBalance ?? data?.availableBalance ?? null;
      if (newBalance != null) setBalance(newBalance);
      const grant: GrantResult = {
        userId: user.userId,
        delta: parsedScore,
        newBalance,
      };
      setResult(grant);
      setScore("");
      setNote("");
      onGranted?.(grant);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // From the success view back to the form for the same user — one step away.
  function grantAgain() {
    setResult(null);
    setScore("");
    setNote("");
    setError(null);
  }

  return (
    <AdminDialog
      open={open}
      title="加积分"
      description="按手机号或邮箱解析用户，给其加 / 扣算力积分（compute_point）。正数加、负数扣，即时生效并写入审计。"
      onClose={onClose}
      footer={
        result ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={grantAgain}>
              再加一笔
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
              {submitting ? "提交中" : parsedScore < 0 ? "扣积分" : "加积分"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        // ── Success view — replaces the form so the result reads clearly
        //    instead of the dialog snapping shut.
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <IconCircleCheckFilled className="size-12 text-emerald-500" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-950">
              {result.delta < 0 ? "扣积分成功" : "加积分成功"}
            </h3>
            <p className="text-[13px] text-slate-500">
              {user?.nickName ? `${user.nickName} · ` : ""}ID {result.userId}
            </p>
          </div>
          <div className="w-full divide-y divide-slate-100 rounded-lg border border-slate-200 text-[13px]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">本次变动</span>
              <span
                className={
                  result.delta < 0
                    ? "font-semibold text-rose-600"
                    : "font-semibold text-emerald-600"
                }
              >
                {formatSignedInteger(String(result.delta))}
              </span>
            </div>
            {result.newBalance != null ? (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-slate-500">算力积分余额</span>
                <span className="font-semibold text-slate-950">{result.newBalance}</span>
              </div>
            ) : null}
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
              <span>
                当前算力积分 <span className="font-semibold text-slate-950">{balance ?? "—"}</span>
              </span>
            </div>
          ) : null}

          <FormLabel label="积分增减" help="正数加分，负数扣分（单位：算力积分）。">
            <TextInput
              value={score}
              inputMode="numeric"
              placeholder="例如 3000 或 -100"
              onChange={(event) => setScore(event.target.value)}
            />
          </FormLabel>

          <FormLabel label="审计备注" help="必填；写入钱包流水 reason。">
            <TextInput
              value={note}
              placeholder="例如 客服补偿、活动发放"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormLabel>

          {error ? <ErrorBanner message={error} /> : null}
        </div>
      )}
    </AdminDialog>
  );
}
