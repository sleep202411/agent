"use client";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { commentsApi, type CommentPage } from "../_hooks/comments";

export function TvComments({ ipId }: { ipId: string }) {
  const { user } = useCurrentUser();
  return <CommentPanel key={`${ipId}:${user?.id ?? "guest"}`} ipId={ipId} userId={user?.id} />;
}
function CommentPanel({ ipId, userId }: { ipId: string; userId?: string }) {
  const t = useTranslations("tvComments");
  const locale = useLocale();
  const { open } = useAuthDialog();
  const [page, setPage] = useState<CommentPage | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const operation = useRef<AbortController | null>(null);
  const request = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    commentsApi
      .list(ipId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (operation.current === controller) {
          operation.current = null;
          setPending(false);
        }
      });
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [ipId]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      await action(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  function load(cursor?: string) {
    void run(async (signal) => {
      const result = await commentsApi.list(ipId, signal, cursor);
      if (!signal.aborted)
        setPage((previous) =>
          cursor
            ? {
                ...result,
                items: [...(previous?.items ?? []), ...result.items].filter(
                  (item, index, items) => items.findIndex((other) => other.id === item.id) === index
                ),
              }
            : result
        );
    });
  }
  function submit() {
    if (!userId) {
      open();
      return;
    }
    const body = draft.trim();
    if (!body) return;
    void run(async (signal) => {
      // Retain the key on failure so a lost response can be retried without duplication.
      if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
      const row = await commentsApi.create(ipId, body, request.current.id, signal);
      if (!signal.aborted) {
        setPage((previous) => ({
          nextCursor: previous?.nextCursor ?? null,
          items: [row, ...(previous?.items ?? []).filter((item) => item.id !== row.id)],
        }));
        setDraft("");
        request.current = null;
      }
    });
  }
  function remove(id: string) {
    void run(async (signal) => {
      await commentsApi.remove(ipId, id, signal);
      if (!signal.aborted)
        setPage(
          (previous) =>
            previous && { ...previous, items: previous.items.filter((item) => item.id !== id) }
        );
    });
  }
  return (
    <aside
      aria-label={t("title")}
      className="flex min-h-80 shrink-0 flex-col gap-3 py-5 text-white md:w-64 md:pl-5 xl:w-80"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">{t("title")}</h2>
        <button
          type="button"
          disabled={pending}
          onClick={() => load()}
          className="min-h-11 rounded-full px-3 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
        >
          {t("refresh")}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-red-400">
          {error}
          <button
            type="button"
            disabled={pending}
            onClick={() => load()}
            className="ml-2 min-h-11 underline"
          >
            {t("retry")}
          </button>
        </div>
      )}
      {!page && pending && (
        <p role="status" className="text-sm text-white/60">
          {t("loading")}
        </p>
      )}
      {page?.items.length === 0 && <p className="text-sm text-white/60">{t("empty")}</p>}
      <ol className="max-h-96 min-h-0 flex-1 space-y-4 overflow-y-auto md:max-h-none">
        {page?.items.map((item) => (
          <li key={item.id} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
              <span>
                {item.authorName || t("viewer")}
                {item.userId === userId ? ` · ${t("you")}` : ""}
              </span>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString(locale)}
              </time>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">{item.body}</p>
            {item.userId === userId && (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(item.id)}
                className="min-h-11 text-xs text-white/60 underline"
              >
                {t("remove")}
              </button>
            )}
          </li>
        ))}
      </ol>
      {page?.nextCursor && (
        <button
          type="button"
          disabled={pending}
          onClick={() => load(page.nextCursor!)}
          className="min-h-11 rounded-full bg-white/10 px-4 text-sm"
        >
          {t("more")}
        </button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-2"
      >
        <label className="block text-sm" htmlFor="tv-comment-draft">
          {t("label")}
        </label>
        <textarea
          id="tv-comment-draft"
          value={draft}
          maxLength={2000}
          disabled={pending || !userId}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          className="w-full rounded-xl bg-white/10 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || (Boolean(userId) && !draft.trim())}
          className="min-h-11 w-full rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
        >
          {userId ? t("send") : t("signIn")}
        </button>
      </form>
    </aside>
  );
}
