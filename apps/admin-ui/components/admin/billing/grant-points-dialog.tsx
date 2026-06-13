"use client";

// GrantPointsDialog — 加 / 扣 Java 老系统积分(client_user.score_balance),
// 装在 AdminDialog 里。由用户列表的头部「加积分」按钮(空标识符)和每行按钮
// (预填该用户)共用。一个事务:锁行 → 写新余额 → 记 integral_record(详见
// 后端 LegacyPointsService)。即时生效。
//
// 不拉积分流水(那已是独立的「积分流水」页);弹窗只做"查余额 → 加/扣分"。

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
  userLevel: string | null;
}

export interface GrantResult {
  userId: string;
  previousBalance: number;
  delta: number;
  newBalance: number;
  recordId: string;
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
  const [lookupDone, setLookupDone] = useState(false);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GrantResult | null>(null);

  const parsedScore = Number(score);
  const scoreValid = Number.isInteger(parsedScore) && parsedScore !== 0;
  const canLookup = Boolean(identifier.trim()) && !looking;
  const canSubmit = Boolean(identifier.trim()) && scoreValid && !submitting;

  // Reset every time the dialog opens; auto-look-up when prefilled. When it
  // closes, clear so re-opening for a different user never shows stale data.
  useEffect(() => {
    if (!open) {
      setIdentifier("");
      setScore("");
      setNote("");
      setUser(null);
      setLookupDone(false);
      setError(null);
      setResult(null);
      return;
    }
    const prefilled = initialIdentifier?.trim() ?? "";
    setIdentifier(prefilled);
    setScore("");
    setNote("");
    setUser(null);
    setLookupDone(false);
    setError(null);
    setResult(null);
    if (prefilled) void lookup(prefilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIdentifier]);

  async function lookup(idArg?: string) {
    const id = (idArg ?? identifier).trim();
    if (!id) return;
    setLooking(true);
    setError(null);
    setResult(null);
    try {
      const u = await requestEnvelope<LegacyUser | null>(
        `/api/admin/legacy-points/users/${encodeURIComponent(id)}`
      );
      setUser(u);
      setLookupDone(true);
    } catch (err) {
      setError(toErrorMessage(err));
      setUser(null);
      setLookupDone(true);
    } finally {
      setLooking(false);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await mutateEnvelope<GrantResult>("/api/admin/legacy-points/grant", {
        identifier: identifier.trim(),
        score: parsedScore,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setResult(data);
      setScore("");
      setNote("");
      await lookup(identifier); // refresh the in-dialog balance
      onGranted?.(data);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // From the success view back to the form, keeping the looked-up user
  // (whose balance was just refreshed) so a follow-up grant is one step away.
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
      description="按手机号或邮箱给用户加 / 扣 Java 老系统积分（score_balance）。负数为扣分，即时生效并写入流水。"
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
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">余额</span>
              <span className="text-slate-700">
                {result.previousBalance} <span className="text-slate-400">→</span>{" "}
                <span className="font-semibold text-slate-950">{result.newBalance}</span>
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">流水号</span>
              <span className="font-mono text-slate-700">#{result.recordId}</span>
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
              <span>
                当前余额 <span className="font-semibold text-slate-950">{user.scoreBalance}</span>
              </span>
              {user.userLevel ? <span>等级 {user.userLevel}</span> : null}
            </div>
          ) : null}

          <FormLabel label="积分增减" help="正数加分，负数扣分。">
            <TextInput
              value={score}
              inputMode="numeric"
              placeholder="例如 3000 或 -100"
              onChange={(event) => setScore(event.target.value)}
            />
          </FormLabel>

          <FormLabel label="审计备注" help="可选；写入流水 remark。">
            <TextInput
              value={note}
              placeholder="例如 手机号用户无法支付，客服补分"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormLabel>

          {error ? <ErrorBanner message={error} /> : null}
        </div>
      )}
    </AdminDialog>
  );
}
