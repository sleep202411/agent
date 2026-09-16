"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { IconChevronDown } from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { api } from "@/src/lib/api";
import { cn } from "@/lib/utils";

type Suggestion = { id: string; title: string; reason: string };
type ChatTurn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; suggestions: Suggestion[] }
  | { id: string; role: "assistant"; error: string };

export function ViewerAssistance({
  open,
  onOpenChange,
  railToggle,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  railToggle?: ReactNode;
} = {}) {
  const { user } = useCurrentUser();
  const locale = useLocale();
  return (
    <Panel
      key={`${user?.id ?? "guest"}:${locale}`}
      signedIn={Boolean(user)}
      locale={locale}
      open={open}
      onOpenChange={onOpenChange}
      railToggle={railToggle}
    />
  );
}

function Panel({
  signedIn,
  locale,
  open: openProp,
  onOpenChange,
  railToggle,
}: {
  signedIn: boolean;
  locale: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  railToggle?: ReactNode;
}) {
  const t = useTranslations("viewerAssistance");
  const { open } = useAuthDialog();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const openPanel = openProp ?? uncontrolledOpen;
  const setOpenPanel = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [preference, setPreference] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    if (!openPanel) return;
    chatEnd.current?.scrollIntoView?.({ block: "end" });
  }, [openPanel, turns, busy]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
  }

  async function ask() {
    const text = preference.trim();
    if (active.current || !text) return;
    if (!signedIn) {
      open();
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setPreference("");
    const userTurnId = crypto.randomUUID();
    setTurns((previous) => [...previous, { id: userTurnId, role: "user", text }]);

    const timeout = setTimeout(() => {
      if (active.current === controller) {
        controller.abort();
        active.current = null;
        setBusy(false);
        setTurns((previous) => [
          ...previous,
          { id: crypto.randomUUID(), role: "assistant", error: t("timeout") },
        ]);
      }
    }, 45000);
    const clearDeadline = () => clearTimeout(timeout);
    controller.signal.addEventListener("abort", clearDeadline, { once: true });

    try {
      const reply = await api.post<{ suggestions: Suggestion[] }>("/aurora/viewer-assistance", {
        data: { preference: text, locale },
        signal: controller.signal,
        timeout: 42_000,
      });
      if (!controller.signal.aborted) {
        setTurns((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            suggestions: reply.suggestions,
          },
        ]);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setTurns((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            error: e instanceof Error ? e.message : String(e),
          },
        ]);
      }
    } finally {
      clearDeadline();
      controller.signal.removeEventListener("abort", clearDeadline);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "flex min-h-0 flex-col border-t border-white/10 text-sm text-white",
        openPanel ? "min-h-0 flex-1" : "shrink-0"
      )}
    >
      <div className="flex shrink-0 items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={openPanel}
          onClick={() => setOpenPanel(!openPanel)}
          className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 px-2 py-2 text-left hover:bg-white/5"
        >
          <h2 className="text-[13px] font-medium tracking-tight">{t("title")}</h2>
          <IconChevronDown
            className={cn(
              "size-4 shrink-0 text-white/50 transition-transform",
              openPanel && "rotate-180"
            )}
            aria-hidden
          />
          <span className="sr-only">{openPanel ? t("collapse") : t("expand")}</span>
        </button>
        {railToggle}
      </div>

      {openPanel ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
            <p className="text-[11px] leading-snug text-white/45">{t("help")}</p>

            {turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id} className="flex justify-end">
                  <p className="max-w-[92%] rounded-2xl rounded-br-md bg-white/15 px-3 py-2 text-[12px] leading-snug">
                    {turn.text}
                  </p>
                </div>
              ) : "error" in turn ? (
                <div key={turn.id} className="flex justify-start">
                  <p
                    role="alert"
                    className="max-w-[92%] rounded-2xl rounded-bl-md bg-red-500/15 px-3 py-2 text-[12px] text-red-300"
                  >
                    {turn.error}
                  </p>
                </div>
              ) : (
                <div key={turn.id} className="flex justify-start">
                  <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-md bg-white/8 px-3 py-2">
                    {turn.suggestions.length === 0 ? (
                      <p role="status" className="text-[12px] text-white/55">
                        {t("empty")}
                      </p>
                    ) : (
                      turn.suggestions.map((row) => (
                        <article key={row.id} className="space-y-0.5">
                          <Link
                            className="text-[12px] font-medium underline"
                            href={`/${locale}/ips/${encodeURIComponent(row.id)}`}
                          >
                            {row.title}
                          </Link>
                          <p className="text-[11px] leading-snug text-white/50">{row.reason}</p>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              )
            )}

            {busy ? (
              <div className="flex justify-start">
                <p
                  role="status"
                  className="rounded-2xl rounded-bl-md bg-white/8 px-3 py-2 text-[12px] text-white/55"
                >
                  {t("pending")}
                </p>
              </div>
            ) : null}
            <div ref={chatEnd} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
            className="shrink-0 space-y-1.5 border-t border-white/10 px-3 py-2"
          >
            <div className="flex gap-1.5">
              <input
                aria-label={t("preference")}
                maxLength={1000}
                value={preference}
                disabled={busy}
                placeholder={t("preference")}
                onChange={(e) => setPreference(e.target.value)}
                className="min-h-9 min-w-0 flex-1 rounded-md bg-white/10 px-2.5 text-[12px] outline-none placeholder:text-white/35 focus-visible:ring-1 focus-visible:ring-white/40"
              />
              <button
                type="submit"
                disabled={busy || !preference.trim()}
                className="min-h-9 shrink-0 rounded-md bg-white px-2.5 text-[12px] font-medium text-black disabled:opacity-50"
              >
                {t("ask")}
              </button>
            </div>
            {busy ? (
              <button
                type="button"
                onClick={cancel}
                className="min-h-8 text-[11px] text-white/55 underline"
              >
                {t("cancel")}
              </button>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}
