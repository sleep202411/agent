"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { IconLoader2, IconMessageCircle } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { Comment } from "@/src/types/workspace";

export function formatMediaTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString().slice(0, 5)}`;
}

export function formatMediaBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}M`;
}

function getCommentChildren(comment: Comment) {
  const children = comment.replies ?? (comment.children as Comment[] | undefined) ?? [];
  return Array.isArray(children) ? children : [];
}

function flattenComments(comments: Comment[], level = 0): Array<Comment & { level: number }> {
  let result: Array<Comment & { level: number }> = [];
  for (const comment of comments) {
    result.push({ ...comment, level });
    const children = getCommentChildren(comment);
    if (children.length > 0) {
      result = result.concat(flattenComments(children, level + 1));
    }
  }
  return result;
}

export function MediaReviewPanel({
  projectId,
  targetType,
  targetId,
}: {
  projectId: string;
  targetType: "IMAGE" | "VIDEO";
  targetId?: string;
}) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const flatComments = useMemo(() => flattenComments(comments), [comments]);

  const loadComments = useCallback(async () => {
    if (!projectId || !targetId) {
      setComments([]);
      return;
    }
    setLoading(true);
    try {
      const data = await backendApi.post<Paginated<Comment>>("/api/user/comment/queryPage", {
        data: { projectId, targetType, targetId, page: 1, pageSize: 50 },
      });
      setComments((data?.list ?? []) as Comment[]);
    } catch (error) {
      console.error("[MediaReviewPanel] 加载评论失败:", error);
      toast.error(t("loadCommentsFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId, targetId, targetType]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const submitComment = useCallback(
    async (content: string, parentCommentId = "-1") => {
      const trimmed = content.trim();
      if (!projectId || !targetId || !trimmed) return false;
      setSubmitting(true);
      try {
        await backendApi.post("/api/user/comment/create", {
          data: {
            projectId,
            targetType,
            targetId,
            content: trimmed,
            imagePaths: [],
            parentCommentId,
          },
        });
        await loadComments();
        return true;
      } catch (error) {
        console.error("[MediaReviewPanel] 保存评论失败:", error);
        toast.error(t("saveCommentFailed"));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadComments, projectId, targetId, targetType]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="text-sm font-medium text-white/90">
          {t("commentsCount", { count: flatComments.length })}
        </div>
      </div>

      <div className="border-b border-white/10 px-5 py-4">
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setReplyingId(null);
            }}
            className="w-full rounded-lg border border-dashed border-white/10 px-3 py-3 text-left text-sm text-white/45 transition-colors hover:border-primary/40 hover:text-white/70"
          >
            {t("addComment")}
          </button>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              placeholder={t("commentPlaceholder")}
              className="border-white/10 bg-black/20 text-white/90 placeholder:text-white/35"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                color="muted"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                {tc("cancel")}
              </Button>
              <Button
                type="button"
                disabled={!draft.trim() || submitting}
                onClick={async () => {
                  const success = await submitComment(draft);
                  if (success) {
                    setDraft("");
                    setEditing(false);
                  }
                }}
              >
                {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
                {t("send")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/45">
            <IconLoader2 className="mr-2 size-4 animate-spin" />
            {t("loadingComments")}
          </div>
        ) : !targetId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/35">
            <IconMessageCircle className="size-8" />
            <span className="text-sm">{t("selectMaterial")}</span>
          </div>
        ) : flatComments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/35">
            <IconMessageCircle className="size-8" />
            <span className="text-sm">{t("noComments")}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {flatComments.map((comment) => {
              const commentId = String(comment.id ?? "");
              const replyDraft = replyDrafts[commentId] ?? "";
              return (
                <div
                  key={commentId || `${comment.nickname}-${comment.createTime}`}
                  className="space-y-2 rounded-xl border border-white/8 bg-black/15 p-3"
                  style={{ marginLeft: comment.level * 16 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white/90">
                        {String(comment.nickname ?? t("unknownUser"))}
                      </div>
                      <div className="mt-1 text-xs text-white/35">
                        {formatMediaTime(String(comment.createTime ?? ""))}
                      </div>
                    </div>
                    {commentId ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await backendApi.post(`/api/user/comment/delete/${commentId}`);
                            await loadComments();
                          } catch (error) {
                            console.error("[MediaReviewPanel] 删除评论失败:", error);
                            toast.error(t("deleteCommentFailed"));
                          }
                        }}
                        className="text-xs text-white/35 transition-colors hover:text-destructive"
                      >
                        {tc("delete")}
                      </button>
                    ) : null}
                  </div>

                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-white/78">
                    {String(comment.content ?? "")}
                  </div>

                  <div className="flex items-center gap-3">
                    {commentId ? (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingId((current) => (current === commentId ? null : commentId));
                          setEditing(false);
                        }}
                        className="text-xs text-white/45 transition-colors hover:text-white/80"
                      >
                        {t("replyAction")}
                      </button>
                    ) : null}
                  </div>

                  {replyingId === commentId ? (
                    <div className="space-y-2 pt-1">
                      <Textarea
                        value={replyDraft}
                        onChange={(event) =>
                          setReplyDrafts((current) => ({
                            ...current,
                            [commentId]: event.target.value,
                          }))
                        }
                        rows={3}
                        placeholder={t("replyPlaceholder")}
                        className="border-white/10 bg-black/20 text-white/90 placeholder:text-white/35"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          color="muted"
                          onClick={() => {
                            setReplyingId(null);
                            setReplyDrafts((current) => ({ ...current, [commentId]: "" }));
                          }}
                        >
                          {tc("cancel")}
                        </Button>
                        <Button
                          type="button"
                          disabled={!replyDraft.trim() || submitting}
                          onClick={async () => {
                            const success = await submitComment(replyDraft, commentId);
                            if (success) {
                              setReplyingId(null);
                              setReplyDrafts((current) => ({ ...current, [commentId]: "" }));
                            }
                          }}
                        >
                          {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
                          {t("sendReply")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
