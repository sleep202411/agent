"use client";

// WorkspaceGrantDialog — 给一个工作区（团队 / 个人）的算力积分池加 / 扣分。
// 独立成文件是因为它有两个入口：财务 →「团队算力池」按名称搜到的工作区，以及
// 用户管理 →「查看」抽屉里该用户参与的每个工作区。两处必须是同一个对话框，
// 否则幂等策略和文案会各写一份。
//
// POST /billing/wallets/workspace-credits（正数加、负数扣，服务端按 admin_adjustment
// 落账）。amount 走字符串，避免大额经 JS number 丢精度。

import { useState } from "react";
import { IconCircleCheckFilled } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  TextInput,
  formatDate,
  formatInteger,
  formatSignedInteger,
  mutateEnvelope,
  toErrorMessage,
} from "./shared";
import type { AdminWorkspaceRow } from "./types";

// POST /billing/wallets/workspace-credits → admin wallet account detail. We only
// read the resulting available balance, tolerant of the exact envelope nesting.
interface CreditResponse {
  account?: { availableBalance?: string };
  availableBalance?: string;
}

export function WorkspaceGrantDialog({
  workspace,
  onClose,
  onGranted,
}: {
  workspace: AdminWorkspaceRow;
  onClose: () => void;
  onGranted: (workspaceId: string, availableBalance: string) => void;
}) {
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ delta: number; newBalance: string | null } | null>(null);
  // Minted once for this grant intent and reused across retries, so a lost
  // response on the first submit can't double-grant on the second click.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const parsedScore = Number(score);
  const scoreValid =
    /^-?\d+$/.test(score.trim()) && Number.isInteger(parsedScore) && parsedScore !== 0;
  const canSubmit = scoreValid && Boolean(note.trim()) && !submitting;

  async function submit() {
    if (!scoreValid || !note.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await mutateEnvelope<CreditResponse>(
        "/api/admin/billing/wallets/workspace-credits",
        {
          workspaceId: workspace.id,
          // String, not number — large grants must not round through 2^53.
          amount: score.trim(),
          reason: note.trim(),
          idempotencyKey,
        }
      );
      const newBalance = data?.account?.availableBalance ?? data?.availableBalance ?? null;
      setResult({ delta: parsedScore, newBalance });
      if (newBalance != null) onGranted(workspace.id, newBalance);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Next grant for the same workspace = a new intent → fresh key + cleared form.
  function grantAgain() {
    setResult(null);
    setScore("");
    setNote("");
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  return (
    <AdminDialog
      open
      title="团队算力加 / 扣分"
      description={`${workspace.type === "team" ? "团队" : "个人"}工作区「${workspace.name}」的算力积分池。正数加、负数扣，即时生效并写入审计。`}
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
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <IconCircleCheckFilled className="size-12 text-emerald-500" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-950">
              {result.delta < 0 ? "扣积分成功" : "加积分成功"}
            </h3>
            <p className="text-[13px] text-slate-500">{workspace.name}</p>
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
                <span className="font-semibold text-slate-950">
                  {formatInteger(result.newBalance)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
            <span>
              工作区 <span className="font-medium text-slate-950">{workspace.name}</span>
            </span>
            <span className="font-mono text-[11px]">{workspace.id}</span>
            <span>成员 {workspace.memberCount}</span>
            <span>
              当前算力积分{" "}
              <span className="font-semibold text-slate-950">
                {workspace.hasWallet ? formatInteger(workspace.availableBalance) : "0"}
              </span>
            </span>
            <span className="text-[11px] text-slate-400">
              创建于 {formatDate(workspace.createdAt)}
            </span>
          </div>

          <FormLabel label="积分增减" help="正数加分，负数扣分（单位：算力积分）。">
            <TextInput
              value={score}
              inputMode="numeric"
              placeholder="例如 50000 或 -100"
              onChange={(event) => setScore(event.target.value)}
            />
          </FormLabel>

          <FormLabel label="审计备注" help="必填；写入钱包流水 reason。">
            <TextInput
              value={note}
              placeholder="例如 企业单发放、事故补偿"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormLabel>

          {error ? <ErrorBanner message={error} /> : null}
        </div>
      )}
    </AdminDialog>
  );
}
