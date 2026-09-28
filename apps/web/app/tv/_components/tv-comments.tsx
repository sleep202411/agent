"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { commentsApi, type CommentPage } from "../_hooks/comments";

export function TvComments({
  ipId,
  open,
  onOpenChange,
  railToggle,
}: {
  ipId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  railToggle?: ReactNode;
}) {
  const { user } = useCurrentUser();
  return (
    <CommentPanel
      key={`${ipId}:${user?.id ?? "guest"}`}
      ipId={ipId}
      userId={user?.id}
      open={open}
      onOpenChange={onOpenChange}
      railToggle={railToggle}
    />
  );
}

function CommentPanel({
  ipId,
  userId,
  open: openProp,
  onOpenChange,
  railToggle,
}: {
  ipId: string;
  userId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  railToggle?: ReactNode;
}) {
  const t = useTranslations("tvComments");
  const locale = useLocale();
  const { open } = useAuthDialog();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const openPanel = openProp ?? uncontrolledOpen;
  const setOpenPanel = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [page, setPage] = useState<CommentPage | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const operation = useRef<AbortController | null>(null);
  const request = useRef<{ body: string; id: string } | null>(null);
  const failedCursor = useRef<string | undefined>(undefined);

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
    failedCursor.current = undefined;
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
      failedCursor.current = cursor;
      const result = await commentsApi.list(ipId, signal, cursor);
      if (!signal.aborted) {
        failedCursor.current = undefined;
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
      }
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

  const count = page?.items.length;

  return (
    <aside
      aria-label={t("title")}
      className={cn(
        "flex min-h-0 flex-col border-b border-white/10 text-white",
        openPanel ? "min-h-0 flex-1" : "shrink-0"
      )}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-1">
        <button
          type="button"
          aria-expanded={openPanel}
          onClick={() => setOpenPanel(!openPanel)}
          className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 px-2 py-2 text-left hover:bg-white/5"
        >
          <h2 className="truncate text-[13px] font-medium tracking-tight">
            {t("title")}
            {typeof count === "number" ? (
              <span className="ml-1.5 font-normal text-white/45">{count}</span>
            ) : null}
          </h2>
          <IconChevronDown
            className={cn(
              "size-4 shrink-0 text-white/50 transition-transform",
              openPanel && "rotate-180"
            )}
            aria-hidden
          />
          <span className="sr-only">{openPanel ? t("collapse") : t("expand")}</span>
        </button>
        {openPanel ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => load()}
            className="min-h-9 shrink-0 rounded-md px-2 text-[11px] text-white/55 hover:bg-white/10 disabled:opacity-50"
          >
            {t("refresh")}
          </button>
        ) : null}
        {railToggle}
      </div>

      {openPanel ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
          {error ? (
            <div role="alert" className="text-[12px] text-red-400">
              {error}
              <button
                type="button"
                disabled={pending}
                onClick={() => load(failedCursor.current)}
                className="ml-2 underline"
              >
                {t("retry")}
              </button>
            </div>
          ) : null}
          {!page && pending ? (
            <p role="status" className="text-[12px] text-white/50">
              {t("loading")}
            </p>
          ) : null}
          {page?.items.length === 0 ? (
            <p className="text-[12px] text-white/50">{t("empty")}</p>
          ) : null}
          <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {page?.items.map((item) => (
              <li key={item.id} className="text-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/45">
                  <span>
                    {item.authorName || t("viewer")}
                    {item.userId === userId ? ` · ${t("you")}` : ""}
                  </span>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString(locale)}
                  </time>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words leading-snug">{item.body}</p>
                {item.userId === userId ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(item.id)}
                    className="mt-0.5 text-[11px] text-white/45 underline"
                  >
                    {t("remove")}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {page?.nextCursor ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => load(page.nextCursor!)}
              className="min-h-9 rounded-md bg-white/10 px-3 text-[12px]"
            >
              {t("more")}
            </button>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="shrink-0 space-y-1.5 border-t border-white/10 pt-2"
          >
            <label className="block text-[11px] text-white/55" htmlFor="tv-comment-draft">
              {t("label")}
            </label>
            <textarea
              id="tv-comment-draft"
              value={draft}
              maxLength={2000}
              disabled={pending || !userId}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              className="w-full resize-none rounded-md bg-white/10 p-2 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pending || (Boolean(userId) && !draft.trim())}
              className="min-h-9 w-full rounded-md bg-white px-3 text-[12px] font-medium text-black disabled:opacity-50"
            >
              {userId ? t("send") : t("signIn")}
            </button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}
