/* eslint-disable @next/next/no-img-element -- Java returns creator-managed media URLs */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconCheck,
  IconDeviceGamepad2,
  IconExternalLink,
  IconFileCode,
  IconInfoCircle,
  IconPhoto,
} from "@tabler/icons-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  isInteractiveFilmAdminActionAllowed,
  type AdminInteractiveFilmDetail,
  type InteractiveFilmAdminAction,
} from "@/lib/interactive-film-admin-contract";
import type { InteractiveFilmPlaybackLoadResult } from "@/lib/interactive-film-playback-view";
import { InteractiveFilmPlaybackSection } from "./playback/playback-section";
import {
  formatInteractiveFilmDate,
  InteractiveFilmErrorBanner,
  InteractiveFilmStatusPill,
  InteractiveFilmSuccessBanner,
  interactiveFilmErrorMessage,
  requestAdminInteractiveFilm,
} from "./shared";

const REJECT_REASON_MAX_CHARACTERS = 1_000;

export function InteractiveFilmReviewDetail({
  siteLabel,
  databaseLabel,
  gameId,
  initialGame,
  initialError,
  playback,
}: {
  siteLabel: string;
  databaseLabel: string;
  gameId: string;
  initialGame: AdminInteractiveFilmDetail | null;
  initialError: string | null;
  /** HLS distribution read; `null` off the cn site, where the section does not exist. */
  playback: InteractiveFilmPlaybackLoadResult | null;
}) {
  const router = useRouter();
  const [game, setGame] = useState(initialGame);
  const [error, setError] = useState<string | null>(initialError);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<InteractiveFilmAdminAction["action"] | null>(
    null
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const rejectReasonCharacterCount = [...rejectReason].length;

  async function runAction(input: InteractiveFilmAdminAction) {
    if (!game || !isInteractiveFilmAdminActionAllowed(game.status, input.action)) {
      const reason = new Error("当前作品状态不允许执行该审核动作，请刷新后重试。");
      setError(reason.message);
      throw reason;
    }
    setPendingAction(input.action);
    setError(null);
    setSuccess(null);
    try {
      const next = await requestAdminInteractiveFilm(gameId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      setGame(next);
      setSuccess(actionSuccessMessage(input.action));
      if (input.action === "reject") {
        setRejectOpen(false);
        setRejectReason("");
      }
      router.refresh();
    } catch (reason) {
      setError(interactiveFilmErrorMessage(reason));
      throw reason;
    } finally {
      setPendingAction(null);
    }
  }

  async function runConfirmedAction(input: InteractiveFilmAdminAction) {
    try {
      await runAction(input);
    } catch {
      // Resolve the confirmation callback so it closes; the actionable Java
      // error is already stored in the visible page banner.
    }
  }

  if (!game) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={`${siteLabel} · ${databaseLabel}`}
          title="影游审核详情"
          description={gameId}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/ip/interactive-films">
                <IconArrowLeft className="size-3.5" />
                返回队列
              </Link>
            </Button>
          }
        />
        <InteractiveFilmErrorBanner message={error ?? "无法加载该影游作品。"} />
        {playback ? (
          <InteractiveFilmPlaybackSection gameId={gameId} title={null} playback={playback} />
        ) : null}
      </div>
    );
  }

  const title = game.title;
  const reviewing = isInteractiveFilmAdminActionAllowed(game.status, "approve");
  const canOffline = isInteractiveFilmAdminActionAllowed(game.status, "offline");
  const busy = pendingAction !== null;

  async function approve() {
    await runConfirmedAction({ action: "approve" });
  }

  async function reject() {
    const reason = rejectReason.trim();
    if (!reason) {
      setError("驳回原因不能为空。");
      return;
    }
    try {
      await runAction({
        action: "reject",
        reason,
      });
    } catch {
      // runAction keeps the actionable upstream error visible in this dialog.
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title={title}
        description={game.gameId}
        icon={<IconDeviceGamepad2 className="size-4" />}
        actions={
          <div className="flex items-center gap-2">
            <InteractiveFilmStatusPill status={game.status} />
            <Button asChild variant="outline" size="sm">
              <Link href="/ip/interactive-films">
                <IconArrowLeft className="size-3.5" />
                返回队列
              </Link>
            </Button>
          </div>
        }
      />

      {error ? <InteractiveFilmErrorBanner message={error} /> : null}
      {success ? <InteractiveFilmSuccessBanner message={success} /> : null}
      {game.rejectReason ? (
        <InteractiveFilmErrorBanner message={`最近一次驳回原因：${game.rejectReason}`} />
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="grid lg:grid-cols-[minmax(320px,44%)_minmax(0,1fr)]">
              <div className="grid place-items-center bg-slate-50 p-5">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                  {game.coverUrl ? (
                    <img
                      src={game.coverUrl}
                      alt={title}
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-slate-300">
                      <IconPhoto className="size-10" />
                    </div>
                  )}
                </div>
              </div>
              <div className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  作品信息
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                  {title}
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {game.subtitle || "未填写副标题"}
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-[12px] text-slate-600">
                  <Fact label="状态" value={statusFact(game.status)} />
                  <Fact label="待审版本" value={game.draftVersion ?? "无"} mono />
                  <Fact label="线上版本" value={game.currentVersion ?? "无"} mono />
                </div>
              </div>
            </div>
          </section>

          <ReviewSection title="发布物核验" icon={<IconFileCode className="size-4" />}>
            <div className="grid gap-3 lg:grid-cols-2">
              <ManifestCard
                label="待审 Manifest"
                version={game.draftVersion}
                url={game.draftManifestUrl}
                emptyLabel="当前没有待审 Manifest。"
              />
              <ManifestCard
                label="线上 Manifest"
                version={game.currentVersion}
                url={game.manifestUrl}
                emptyLabel="当前没有可核验的线上 Manifest。"
              />
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-800">
              <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
              <p>
                玩家接口只开放已发布版本。本页不会伪造未发布试玩；当前后端只提供版本与 Manifest
                地址，请通过待审发布物完成核验。
              </p>
            </div>
          </ReviewSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-16">
          <ReviewSection title="审核材料">
            <ReviewCheck label="封面" ready={Boolean(game.coverUrl)} />
            <ReviewCheck label="待审版本" ready={Boolean(game.draftVersion)} />
            <ReviewCheck label="待审 Manifest" ready={Boolean(game.draftManifestUrl)} />
          </ReviewSection>

          <ReviewSection title="版本信息">
            <MetadataRow label="待审版本" value={game.draftVersion ?? "-"} mono />
            <MetadataRow label="线上版本" value={game.currentVersion ?? "-"} mono />
            <MetadataRow label="创作者 ID" value={game.creatorId ?? "-"} mono />
            <MetadataRow label="创建时间" value={formatInteractiveFilmDate(game.createdAt)} />
            <MetadataRow label="更新时间" value={formatInteractiveFilmDate(game.updatedAt)} />
            <MetadataRow label="发布时间" value={formatInteractiveFilmDate(game.publishedAt)} />
            <MetadataRow label="下架时间" value={formatInteractiveFilmDate(game.offlineAt)} />
          </ReviewSection>

          <ReviewSection title="审核决策">
            {reviewing ? (
              <>
                <ConfirmDialog
                  title="确认通过该影游？"
                  description={`通过后，《${title}》的待审版本会晋升为玩家可见的线上版本。`}
                  confirmLabel="通过并发布"
                  onConfirm={approve}
                  trigger={
                    <Button className="w-full" disabled={busy}>
                      <IconCheck className="size-4" />
                      通过并发布
                    </Button>
                  }
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setRejectOpen(true);
                  }}
                >
                  驳回修改
                </Button>
              </>
            ) : (
              <p className="text-[12px] leading-5 text-slate-500">
                当前作品不在审核中，不能执行通过或驳回。
              </p>
            )}

            {canOffline ? (
              <ConfirmDialog
                title="确认强制下架该影游？"
                description={`《${title}》将从玩家列表、详情和新开局中隐藏；已经开始的 Session 仍可继续上报。`}
                confirmLabel="确认强制下架"
                destructive
                onConfirm={() => runConfirmedAction({ action: "offline" })}
                trigger={
                  <Button variant="destructive" className="w-full" disabled={busy}>
                    强制下架
                  </Button>
                }
              />
            ) : null}
          </ReviewSection>
        </aside>
      </div>

      {playback ? (
        <InteractiveFilmPlaybackSection gameId={gameId} title={title} playback={playback} />
      ) : null}

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (pendingAction === "reject") return;
          setRejectOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={pendingAction !== "reject"}>
          <DialogHeader>
            <DialogTitle>驳回《{title}》</DialogTitle>
            <DialogDescription>
              原因会写入作品并展示给创作者。请明确指出需要修改的封面、元数据或发布物问题。
            </DialogDescription>
          </DialogHeader>
          <div>
            <label
              htmlFor="interactive-film-reject-reason"
              className="text-[12px] font-medium text-slate-700"
            >
              驳回原因 <span className="text-red-600">*</span>
            </label>
            <Textarea
              id="interactive-film-reject-reason"
              value={rejectReason}
              onChange={(event) =>
                setRejectReason(
                  [...event.target.value].slice(0, REJECT_REASON_MAX_CHARACTERS).join("")
                )
              }
              placeholder="例如：封面与作品内容不符，请更换后重新提交。"
              disabled={pendingAction === "reject"}
              className="mt-2 min-h-28"
            />
            <p className="mt-1 text-right text-[11px] text-slate-400">
              {rejectReasonCharacterCount} / {REJECT_REASON_MAX_CHARACTERS}
            </p>
          </div>
          {error ? <InteractiveFilmErrorBanner message={error} /> : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pendingAction === "reject"}
              onClick={() => setRejectOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || pendingAction === "reject"}
              onClick={() => void reject()}
            >
              确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-center gap-2 text-slate-500">
        {icon}
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ManifestCard({
  label,
  version,
  url,
  emptyLabel,
}: {
  label: string;
  version: string | null;
  url: string | null;
  emptyLabel: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-[12px] font-medium text-slate-900">{label}</p>
      <p className="mt-1 break-all font-mono text-[10px] leading-4 text-slate-500">
        {version ?? "无版本"}
      </p>
      {url ? (
        <Button asChild variant="outline" size="sm" className="mt-3 w-full bg-white">
          <a href={url} target="_blank" rel="noopener noreferrer">
            打开 Manifest
            <IconExternalLink className="ml-auto size-3.5" />
          </a>
        </Button>
      ) : (
        <p className="mt-3 text-[12px] leading-5 text-slate-500">{emptyLabel}</p>
      )}
    </article>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="max-w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
      {label} ·{" "}
      <strong
        className={
          mono ? "break-all font-mono text-[11px] text-slate-900" : "font-medium text-slate-900"
        }
      >
        {value}
      </strong>
    </span>
  );
}

function ReviewCheck({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
      <span className="text-slate-600">{label}</span>
      <span className={ready ? "text-emerald-700" : "text-red-700"}>
        {ready ? "已提供" : "缺失"}
      </span>
    </div>
  );
}

function MetadataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-[12px] text-slate-500">{label}</span>
      <span
        className={
          mono
            ? "max-w-[190px] break-all text-right font-mono text-[11px] text-slate-700"
            : "text-right text-[12px] text-slate-700"
        }
      >
        {value}
      </span>
    </div>
  );
}

function statusFact(status: AdminInteractiveFilmDetail["status"]): string {
  return {
    draft: "草稿",
    reviewing: "审核中",
    published: "已发布",
    offline: "已下架",
  }[status];
}

function actionSuccessMessage(action: InteractiveFilmAdminAction["action"]): string {
  return {
    approve: "审核通过，待审版本已晋升为线上版本。",
    reject: "作品已驳回，创作者可以修改后重新提交。",
    offline: "作品已强制下架。",
  }[action];
}
