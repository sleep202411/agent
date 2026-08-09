/* eslint-disable @next/next/no-img-element -- Java returns creator-managed media URLs */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconExternalLink,
  IconFileTypeDocx,
  IconMusic,
  IconPhoto,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import {
  isTextGameBossActionAllowed,
  type TextGameBossAction,
  type TextGameDetail,
} from "@repo/shared/text-game";
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
  formatTextGameDate,
  requestAdminTextGame,
  TextGameErrorBanner,
  TextGameStatusPill,
  TextGameSuccessBanner,
  textGameErrorMessage,
} from "./shared";

export function TextGameReviewDetail({
  siteLabel,
  databaseLabel,
  gameId,
  initialGame,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  gameId: string;
  initialGame: TextGameDetail | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [game, setGame] = useState(initialGame);
  const [error, setError] = useState<string | null>(initialError);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TextGameBossAction["action"] | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  async function runAction(input: TextGameBossAction) {
    if (!game || !isTextGameBossActionAllowed(game.status, input.action)) {
      const reason = new Error("当前作品状态不允许执行该审核动作，请刷新后重试。");
      setError(reason.message);
      throw reason;
    }
    setPendingAction(input.action);
    setError(null);
    setSuccess(null);
    try {
      const next = await requestAdminTextGame<TextGameDetail>(
        `/api/admin/text-games/${encodeURIComponent(gameId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      setGame(next);
      setSuccess(actionSuccessMessage(input.action));
      if (input.action === "reject") {
        setRejectOpen(false);
        setRejectReason("");
      }
      router.refresh();
    } catch (reason) {
      setError(textGameErrorMessage(reason));
      throw reason;
    } finally {
      setPendingAction(null);
    }
  }

  async function reject() {
    const reason = rejectReason.trim();
    if (!reason) {
      setError("驳回原因不能为空。");
      return;
    }
    try {
      await runAction({ action: "reject", reason });
    } catch {
      // runAction already preserves the upstream error in the open dialog.
    }
  }

  if (!game) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={`${siteLabel} · ${databaseLabel}`}
          title="文游审核详情"
          description={gameId}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/ip/text-games">
                <IconArrowLeft className="size-3.5" />
                返回队列
              </Link>
            </Button>
          }
        />
        <TextGameErrorBanner message={error ?? "无法加载该文游作品。"} />
      </div>
    );
  }

  const content = game.content;
  const title = content.name || "未命名文游";
  const reviewing = isTextGameBossActionAllowed(game.status, "approve");
  const canForceOffline = isTextGameBossActionAllowed(game.status, "force_offline");
  const busy = pendingAction !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title={title}
        description={game.gameId}
        icon={<IconBook2 className="size-4" />}
        actions={
          <div className="flex items-center gap-2">
            <TextGameStatusPill status={game.status} />
            <Button asChild variant="outline" size="sm">
              <Link href="/ip/text-games">
                <IconArrowLeft className="size-3.5" />
                返回队列
              </Link>
            </Button>
          </div>
        }
      />

      {error ? <TextGameErrorBanner message={error} /> : null}
      {success ? <TextGameSuccessBanner message={success} /> : null}
      {game.rejectReason ? (
        <TextGameErrorBanner message={`最近一次驳回原因：${game.rejectReason}`} />
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="grid place-items-center bg-slate-50 p-5">
                <div className="relative aspect-[2/3] w-full max-w-[260px] overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                  {content.posterUrl ? (
                    <img src={content.posterUrl} alt={title} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-slate-300">
                      <IconPhoto className="size-10" />
                    </div>
                  )}
                </div>
              </div>
              <div className="p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  作品简介
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                  {title}
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {content.synopsis || "未填写简介"}
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-[12px] text-slate-600">
                  <Fact label="版本" value={`v${content.versionNo}`} />
                  <Fact label="角色" value={`${content.characters.length}`} />
                  <Fact label="剧照" value={`${content.stillUrls.length}`} />
                  <Fact label="背景音乐" value={content.bgmUrl ? "已上传" : "无"} />
                </div>
              </div>
            </div>
          </section>

          <ReviewSection title="解析角色" icon={<IconUsers className="size-4" />}>
            {content.characters.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {content.characters
                  .slice()
                  .sort((left, right) => left.sortOrder - right.sortOrder)
                  .map((character) => (
                    <article
                      key={character.id}
                      className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                    >
                      <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white text-slate-400">
                        {character.avatarUrl ? (
                          <img
                            src={character.avatarUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <IconUser className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-slate-950">
                          {character.name || "未命名角色"}
                        </h3>
                        <p className="mt-1 text-[12px] leading-5 text-slate-600">
                          {character.intro || "暂无角色介绍"}
                        </p>
                      </div>
                    </article>
                  ))}
              </div>
            ) : (
              <EmptyReviewContent label="世界观文档未解析出角色" />
            )}
          </ReviewSection>

          <ReviewSection title="剧照" icon={<IconPhoto className="size-4" />}>
            {content.stillUrls.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {content.stillUrls.map((url, index) => (
                  <a
                    key={`${url}:${index}`}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    <img src={url} alt={`剧照 ${index + 1}`} className="size-full object-cover" />
                    <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <IconExternalLink className="size-3.5" />
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <EmptyReviewContent label="未上传剧照" />
            )}
          </ReviewSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-16">
          <ReviewSection title="审核材料" icon={<IconFileTypeDocx className="size-4" />}>
            <ReviewCheck label="作品名称" ready={Boolean(content.name?.trim())} />
            <ReviewCheck label="封面" ready={Boolean(content.posterUrl)} />
            <ReviewCheck label="简介" ready={Boolean(content.synopsis?.trim())} />
            <ReviewCheck label="世界观 DOCX" ready={Boolean(content.worldviewDocxUrl)} />
            {content.worldviewDocxUrl ? (
              <Button asChild variant="outline" className="mt-2 w-full">
                <a href={content.worldviewDocxUrl} target="_blank" rel="noreferrer">
                  <IconFileTypeDocx className="size-4" />
                  打开世界观文档
                  <IconExternalLink className="ml-auto size-3.5" />
                </a>
              </Button>
            ) : null}
            {content.bgmUrl ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                  <IconMusic className="size-3.5" />
                  背景音乐
                </p>
                <audio controls preload="metadata" src={content.bgmUrl} className="h-9 w-full" />
              </div>
            ) : null}
          </ReviewSection>

          <ReviewSection title="版本信息">
            <MetadataRow label="草稿版本" value={game.draftVersionId} mono />
            <MetadataRow label="线上版本" value={game.publishedVersionId ?? "-"} mono />
            <MetadataRow label="创建时间" value={formatTextGameDate(game.createdAt)} />
            <MetadataRow label="更新时间" value={formatTextGameDate(game.updatedAt)} />
            <MetadataRow label="发布时间" value={formatTextGameDate(game.publishedAt)} />
            <MetadataRow label="下架时间" value={formatTextGameDate(game.offlineAt)} />
          </ReviewSection>

          <ReviewSection title="审核决策">
            {reviewing ? (
              <>
                <ConfirmDialog
                  title="确认通过该文游？"
                  description={`通过后，《${title}》的当前草稿版本会立即成为玩家可见的线上版本。`}
                  confirmLabel="通过并发布"
                  onConfirm={() => runAction({ action: "approve" })}
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

            {canForceOffline ? (
              <ConfirmDialog
                title="确认强制下架该文游？"
                description={`《${title}》将从玩家列表和详情页隐藏；已经开始的对局仍可继续。`}
                confirmLabel="确认强制下架"
                destructive
                onConfirm={() => runAction({ action: "force_offline" })}
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
              原因会写入作品并展示给创作者。请明确指出需要修改的文档、封面、剧照或简介问题。
            </DialogDescription>
          </DialogHeader>
          <div>
            <label
              htmlFor="text-game-reject-reason"
              className="text-[12px] font-medium text-slate-700"
            >
              驳回原因 <span className="text-red-600">*</span>
            </label>
            <Textarea
              id="text-game-reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="例如：封面与简介表达的故事主题不一致，请更换后重新提交。"
              maxLength={1000}
              disabled={pendingAction === "reject"}
              className="mt-2 min-h-28"
            />
            <p className="mt-1 text-right text-[11px] text-slate-400">
              {rejectReason.length} / 1000
            </p>
          </div>
          {error ? <TextGameErrorBanner message={error} /> : null}
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
      {label} · <strong className="font-medium text-slate-900">{value}</strong>
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

function EmptyReviewContent({ label }: { label: string }) {
  return <p className="py-8 text-center text-[13px] text-slate-400">{label}</p>;
}

function actionSuccessMessage(action: TextGameBossAction["action"]): string {
  return {
    approve: "审核通过，当前草稿版本已发布。",
    reject: "作品已驳回草稿，创作者可以修改后重新提交。",
    force_offline: "作品已强制下架。",
  }[action];
}
