"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconRefresh } from "@tabler/icons-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { adminUiApiPath } from "@/lib/admin-api";
import type { AdminHomeworkRow } from "@/lib/admin-academy-learning";

const STATUS_LABEL: Record<AdminHomeworkRow["status"], string> = {
  enrolled: "已报名",
  submitted: "待审批",
  revision: "需修改",
  approved: "已通过",
};

export function CourseHomeworkPanel({
  siteLabel,
  databaseLabel,
  initialItems,
  nextCursor,
  loadError,
  canReview,
  scope,
  platformUserId,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialItems: AdminHomeworkRow[];
  nextCursor: string | null;
  loadError: string | null;
  canReview: boolean;
  scope: "lecturer" | "operator";
  platformUserId: string | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [selected, setSelected] = useState<AdminHomeworkRow | null>(null);
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState(loadError);
  const [loaded, setLoaded] = useState({ initialItems, loadError });
  if (loaded.initialItems !== initialItems || loaded.loadError !== loadError) {
    setLoaded({ initialItems, loadError });
    setItems(initialItems);
    setError(loadError);
    setSelected(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="作业审核"
        description="审核学员提交的课程作业；通过后发放技能徽章并结算授课收入。"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() =>
              startRefresh(() => {
                setError(null);
                router.refresh();
              })
            }
          >
            <IconRefresh className="size-4" />
            刷新
          </Button>
        }
      />
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {scope === "lecturer" && platformUserId
          ? `当前按已绑定的 Web 讲师 ID ${platformUserId} 仅显示你的课程作业。`
          : "当前为运营视角（未绑定 Web 讲师 ID），显示全部待审作业。在「账号权限」里为老师账号填写 Web 用户 ID 即可切换为讲师视角。"}
      </p>
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">暂无待审作业。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {["课程", "学员", "教师", "状态", "收入", "操作"].map((label) => (
                  <th key={label} className="px-4 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{row.courseTitle}</td>
                  <td className="px-4 py-3">{row.studentName}</td>
                  <td className="px-4 py-3">{row.teacherName}</td>
                  <td className="px-4 py-3">{STATUS_LABEL[row.status]}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.status === "approved" ? row.teacherCredits : "0"}
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                      {row.status === "submitted" && canReview ? "审批" : "查看"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Homework pages" className="flex items-center gap-4 text-sm">
        <Link href="/courses/homework" className="underline">
          First page
        </Link>
        {nextCursor ? (
          <Link
            href={`/courses/homework?after=${encodeURIComponent(nextCursor)}`}
            className="underline"
          >
            Next page
          </Link>
        ) : null}
      </nav>
      {selected ? (
        <HomeworkReviewDialog
          row={selected}
          canReview={canReview && selected.status === "submitted"}
          close={() => setSelected(null)}
          onSaved={(next) => {
            setItems((prev) =>
              prev.map((item) => (item.id === next.id ? { ...item, ...next } : item))
            );
            setSelected(null);
            router.refresh();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function HomeworkReviewDialog({
  row,
  canReview,
  close,
  onSaved,
  onError,
}: {
  row: AdminHomeworkRow;
  canReview: boolean;
  close: () => void;
  onSaved: (row: AdminHomeworkRow) => void;
  onError: (message: string) => void;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");

  async function decide(decision: "approved" | "revision") {
    if (lock.current || !canReview) return;
    lock.current = true;
    setBusy(true);
    setLocalError("");
    try {
      const response = await fetch(
        adminUiApiPath(
          `/api/admin/academy/learning/enrollments/${encodeURIComponent(row.id)}/review`
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedVersion: row.version,
            decision,
            score: Number(score),
            feedback,
          }),
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        code?: number;
        msg?: string;
        message?: string;
        data?: AdminHomeworkRow;
      } | null;
      if (!response.ok || payload?.code !== 200 || !payload.data) {
        throw new Error(payload?.msg || payload?.message || `审核失败：${response.status}`);
      }
      onSaved({
        ...row,
        ...payload.data,
        courseTitle: row.courseTitle,
        studentName: row.studentName,
        teacherName: row.teacherName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "审核失败。";
      setLocalError(message);
      onError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">作业详情</h2>
          <Button variant="outline" size="sm" disabled={busy} onClick={close}>
            关闭
          </Button>
        </div>
        <dl className="mb-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">课程</dt>
            <dd>{row.courseTitle}</dd>
          </div>
          <div>
            <dt className="text-slate-500">学员</dt>
            <dd>{row.studentName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">教师</dt>
            <dd>{row.teacherName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">状态</dt>
            <dd>{STATUS_LABEL[row.status]}</dd>
          </div>
        </dl>
        <p className="mb-3 whitespace-pre-wrap text-sm text-slate-800">{row.description}</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {row.assetIds.map((assetId, index) => (
            <Button
              key={assetId}
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const response = await fetch(
                    adminUiApiPath(
                      `/api/admin/academy/learning/enrollments/${encodeURIComponent(row.id)}/attachments/${encodeURIComponent(assetId)}`
                    )
                  );
                  const payload = (await response.json().catch(() => null)) as {
                    code?: number;
                    msg?: string;
                    data?: { url: string };
                  } | null;
                  if (!response.ok || payload?.code !== 200 || !payload.data?.url) {
                    throw new Error(payload?.msg || "附件打开失败。");
                  }
                  window.open(payload.data.url, "_blank", "noopener,noreferrer");
                } catch (error) {
                  setLocalError(error instanceof Error ? error.message : "附件打开失败。");
                }
              }}
            >
              附件 {index + 1}
            </Button>
          ))}
        </div>
        {row.feedback ? (
          <p className="mb-3 text-sm text-slate-600">
            {row.score}/100 · {row.feedback}
          </p>
        ) : null}
        {localError ? (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {localError}
          </p>
        ) : null}
        {canReview ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void decide("approved");
            }}
          >
            <label className="grid gap-2 text-sm">
              评分（0–100）
              <input
                required
                type="number"
                min={0}
                max={100}
                value={score}
                disabled={busy}
                onChange={(event) => setScore(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <label className="grid gap-2 text-sm">
              评语
              <textarea
                required
                maxLength={10000}
                value={feedback}
                disabled={busy}
                onChange={(event) => setFeedback(event.target.value)}
                className="min-h-28 rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
                通过并提交
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  score === "" ||
                  !feedback.trim() ||
                  Number(score) < 0 ||
                  Number(score) > 100
                }
                onClick={() => void decide("revision")}
              >
                退回修改
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
