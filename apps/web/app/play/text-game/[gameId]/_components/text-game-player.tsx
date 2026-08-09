"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconHistory,
  IconInfoCircle,
  IconLibrary,
  IconLoader2,
  IconMusic,
  IconMusicOff,
  IconRefresh,
  IconSend2,
  IconUser,
} from "@tabler/icons-react";
import type {
  TextGameDetail,
  TextGameMessage,
  TextGamePlaySession,
  TextGameSummary,
} from "@repo/shared/text-game";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  loadOrStartTextGameSession,
  playerTextGameKeys,
  sendTextGameAction,
  startTextGameSession,
} from "../../_lib/text-game-player-api";

export function TextGamePlayer({
  game,
  catalogue,
}: {
  game: TextGameDetail;
  catalogue: TextGameSummary[];
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("textGame.player");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [stillIndex, setStillIndex] = useState(0);
  const [soundPlaying, setSoundPlaying] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef(false);
  const restartingRef = useRef(false);
  const content = game.content;

  const sessionQuery = useQuery({
    queryKey: playerTextGameKeys.session(game.gameId),
    queryFn: async () => {
      const next = await loadOrStartTextGameSession(game.gameId);
      queryClient.setQueryData(playerTextGameKeys.progress(game.gameId), next);
      return next;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const session = sessionQuery.data;
  const stills = session?.stillUrls.length ? session.stillUrls : content.stillUrls;
  const bgmUrl = session?.bgmUrl || content.bgmUrl;

  useEffect(() => {
    if (stills.length < 2) return;
    const timer = window.setInterval(
      () => setStillIndex((current) => (current + 1) % stills.length),
      7_000
    );
    return () => window.clearInterval(timer);
  }, [stills.length]);

  const visibleStillIndex = stills.length > 0 ? stillIndex % stills.length : 0;
  const messages = session?.messages ?? [];
  const messageCount = session?.messages.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: messageCount > 1 ? "smooth" : "auto" });
  }, [messageCount, sending]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.35;
  }, [bgmUrl]);

  const activeStill = stills[visibleStillIndex] ?? null;
  const otherGames = useMemo(
    () => catalogue.filter((entry) => entry.gameId !== game.gameId),
    [catalogue, game.gameId]
  );

  const toggleSound = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setSoundPlaying(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("soundUnavailable"));
      }
    } else {
      audio.pause();
      setSoundPlaying(false);
    }
  }, [t]);

  async function submitAction() {
    const value = draft.trim();
    if (!value || !session || sendingRef.current) return;

    const optimisticId = `pending-${Date.now()}`;
    const optimistic: TextGameMessage = {
      id: optimisticId,
      role: "user",
      content: value,
      createdAt: new Date().toISOString(),
    };
    sendingRef.current = true;
    setDraft("");
    setSending(true);
    queryClient.setQueryData<TextGamePlaySession>(
      playerTextGameKeys.session(game.gameId),
      (current) => (current ? { ...current, messages: [...current.messages, optimistic] } : current)
    );
    try {
      const response = await sendTextGameAction(session.sessionId, value);
      queryClient.setQueryData<TextGamePlaySession>(
        playerTextGameKeys.session(game.gameId),
        (current) =>
          current
            ? {
                ...current,
                messages: [
                  ...current.messages.filter((message) => message.id !== optimisticId),
                  response.userMessage,
                  response.assistantMessage,
                ],
              }
            : current
      );
    } catch (error) {
      queryClient.setQueryData<TextGamePlaySession>(
        playerTextGameKeys.session(game.gameId),
        (current) =>
          current
            ? {
                ...current,
                messages: current.messages.filter((message) => message.id !== optimisticId),
              }
            : current
      );
      setDraft(value);
      toast.error(error instanceof Error ? error.message : t("sendFailed"));
    } finally {
      sendingRef.current = false;
      setSending(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function restart() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    setRestarting(true);
    try {
      const next = await startTextGameSession(game.gameId);
      queryClient.setQueryData(playerTextGameKeys.session(game.gameId), next);
      queryClient.setQueryData(playerTextGameKeys.progress(game.gameId), next);
      setDraft("");
      toast.success(t("restartComplete"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("restartFailed"));
    } finally {
      restartingRef.current = false;
      setRestarting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitAction();
    }
  }

  return (
    <main className="grid h-[100dvh] overflow-hidden bg-[#0f1012] text-[#f5f4f1] min-[1120px]:grid-cols-[250px_minmax(0,1fr)_320px]">
      {bgmUrl ? (
        <audio
          ref={audioRef}
          src={bgmUrl}
          loop
          preload="metadata"
          onPause={() => setSoundPlaying(false)}
          onPlay={() => setSoundPlaying(true)}
        />
      ) : null}

      <aside
        aria-label={t("libraryTitle")}
        className="hidden min-h-0 bg-[#131416] min-[1120px]:flex min-[1120px]:flex-col"
      >
        <div className="px-5 pt-5 pb-4">
          <Link
            href={localizePath("/games", locale)}
            className="inline-flex items-center gap-2 text-sm font-medium text-white/62 transition-colors hover:text-white"
          >
            <IconArrowLeft className="size-4" />
            {t("backToLibrary")}
          </Link>
          <div className="mt-7 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-white/8">
              <IconLibrary className="size-4 text-white/72" />
            </span>
            <div>
              <p className="text-sm font-semibold">{t("libraryTitle")}</p>
              <p className="text-xs text-white/40">{t("libraryDescription")}</p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-5" aria-label={t("libraryTitle")}>
          <GameRailItem game={game} locale={locale} active label={t("currentWork")} />
          {otherGames.map((entry) => (
            <GameRailItem key={entry.gameId} game={entry} locale={locale} />
          ))}
          {otherGames.length === 0 ? (
            <p className="px-3 py-8 text-xs leading-5 text-white/34">{t("noOtherWorks")}</p>
          ) : null}
        </nav>
      </aside>

      <section className="relative flex min-w-0 flex-col overflow-hidden bg-[#17181a]">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              color="muted"
              size="icon"
              className="text-white/64 hover:bg-white/8 hover:text-white min-[1120px]:hidden"
              onClick={() => setLibraryOpen(true)}
              aria-label={t("openLibrary")}
            >
              <IconLibrary className="size-5" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{content.name || t("untitled")}</p>
              <p className="hidden text-xs text-white/38 sm:block">
                {session?.resumed ? t("resumedSession") : t("newSession")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {bgmUrl ? (
              <Button
                variant="ghost"
                color="muted"
                size="icon"
                className="text-white/58 hover:bg-white/8 hover:text-white"
                onClick={() => void toggleSound()}
                aria-label={soundPlaying ? t("pauseSoundtrack") : t("playSoundtrack")}
              >
                {soundPlaying ? (
                  <IconMusic className="size-5" />
                ) : (
                  <IconMusicOff className="size-5" />
                )}
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon"
                  className="text-white/58 hover:bg-white/8 hover:text-white"
                  aria-label={t("restart")}
                  disabled={restarting}
                >
                  {restarting ? (
                    <IconLoader2 className="size-5 animate-spin" />
                  ) : (
                    <IconRefresh className="size-5" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-[#202124] text-white ring-white/10">
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("restartTitle")}</AlertDialogTitle>
                  <AlertDialogDescription className="text-white/52">
                    {t("restartDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="border-white/8 bg-white/3">
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction disabled={restarting} onClick={() => void restart()}>
                    {t("restart")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="ghost"
              color="muted"
              size="icon"
              className="text-white/58 hover:bg-white/8 hover:text-white min-[1120px]:hidden"
              onClick={() => setInfoOpen(true)}
              aria-label={t("openInfo")}
            >
              <IconInfoCircle className="size-5" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-32 sm:px-8">
          <div className="mx-auto w-full max-w-[760px] pt-10 sm:pt-14">
            <div className="mb-12 text-center">
              <p className="text-xs font-semibold tracking-[0.2em] text-white/34 uppercase">
                {t("storyBegins")}
              </p>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                {content.name || t("untitled")}
              </h1>
            </div>

            {sessionQuery.isLoading ? (
              <div className="flex flex-col items-center py-24 text-center">
                <IconLoader2 className="size-6 animate-spin text-white/48" />
                <p className="mt-4 text-sm text-white/46">{t("openingStory")}</p>
              </div>
            ) : null}

            {sessionQuery.isError ? (
              <div role="alert" className="rounded-2xl bg-red-500/8 px-5 py-4 text-sm text-red-200">
                <p className="font-semibold">{t("loadFailed")}</p>
                <p className="mt-1 text-red-200/68">
                  {sessionQuery.error instanceof Error
                    ? sessionQuery.error.message
                    : t("loadFailedDescription")}
                </p>
                <Button
                  variant="soft"
                  color="destructive"
                  className="mt-4"
                  onClick={() => void sessionQuery.refetch()}
                >
                  {t("retry")}
                </Button>
              </div>
            ) : null}

            <div className="space-y-10">
              {messages.map((message) => (
                <StoryMessage key={message.id} message={message} actionLabel={t("yourAction")} />
              ))}
              {sending ? (
                <div className="flex items-center gap-3 py-3 text-sm text-white/42">
                  <IconLoader2 className="size-4 animate-spin" />
                  {t("storyResponding")}
                </div>
              ) : null}
            </div>
            <div ref={endRef} className="h-10" />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-[#17181a] via-[#17181a] to-transparent px-4 pt-10 pb-4 sm:px-8 sm:pb-6">
          <div className="pointer-events-auto mx-auto flex max-w-[760px] items-end gap-2 rounded-2xl bg-[#242529] p-2 ring-1 ring-white/9 shadow-2xl shadow-black/25">
            <TextareaAutosize
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              minRows={1}
              maxRows={5}
              disabled={!session || sending}
              placeholder={t("actionPlaceholder")}
              aria-label={t("actionPlaceholder")}
              className="min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-5 text-white outline-none placeholder:text-white/28 disabled:opacity-50"
            />
            <Button
              size="icon-lg"
              className="size-10 rounded-xl"
              disabled={!draft.trim() || !session || sending}
              onClick={() => void submitAction()}
              aria-label={t("sendAction")}
            >
              {sending ? (
                <IconLoader2 className="size-5 animate-spin" />
              ) : (
                <IconSend2 className="size-5" />
              )}
            </Button>
          </div>
          <p className="pointer-events-auto mx-auto mt-2 max-w-[760px] text-center text-[11px] text-white/25">
            {t("composerHint")}
          </p>
        </div>
      </section>

      <aside
        aria-label={t("workInformation")}
        className="hidden min-h-0 overflow-y-auto bg-[#131416] min-[1120px]:block"
      >
        <InfoRail
          game={game}
          activeStill={activeStill}
          stillIndex={visibleStillIndex}
          stillCount={stills.length}
          onPrevious={() => setStillIndex((visibleStillIndex - 1 + stills.length) % stills.length)}
          onNext={() => setStillIndex((current) => (current + 1) % stills.length)}
          soundPlaying={soundPlaying}
          hasSound={Boolean(bgmUrl)}
          onToggleSound={() => void toggleSound()}
          t={t}
        />
      </aside>

      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="left" className="border-white/8 bg-[#131416] text-white ring-white/10">
          <SheetHeader className="border-white/8">
            <SheetTitle>{t("libraryTitle")}</SheetTitle>
            <SheetDescription className="text-white/42">{t("libraryDescription")}</SheetDescription>
          </SheetHeader>
          <SheetBody className="px-3 py-3">
            <GameRailItem game={game} locale={locale} active label={t("currentWork")} />
            {otherGames.map((entry) => (
              <GameRailItem key={entry.gameId} game={entry} locale={locale} />
            ))}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="border-white/8 bg-[#131416] text-white ring-white/10">
          <SheetHeader className="border-white/8">
            <SheetTitle>{content.name || t("untitled")}</SheetTitle>
            <SheetDescription className="text-white/42">{t("workInformation")}</SheetDescription>
          </SheetHeader>
          <SheetBody className="p-0">
            <InfoRail
              game={game}
              activeStill={activeStill}
              stillIndex={visibleStillIndex}
              stillCount={stills.length}
              onPrevious={() =>
                setStillIndex((visibleStillIndex - 1 + stills.length) % stills.length)
              }
              onNext={() => setStillIndex((current) => (current + 1) % stills.length)}
              soundPlaying={soundPlaying}
              hasSound={Boolean(bgmUrl)}
              onToggleSound={() => void toggleSound()}
              t={t}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </main>
  );
}

function StoryMessage({ message, actionLabel }: { message: TextGameMessage; actionLabel: string }) {
  if (message.role === "system") {
    return <p className="text-center text-xs text-white/30">{message.content}</p>;
  }
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[82%] text-right">
        <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-white/30 uppercase">
          {actionLabel}
        </p>
        <p className="inline-block rounded-2xl rounded-tr-sm bg-white/8 px-4 py-3 text-left text-sm leading-6 text-white/74">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <article className="font-serif text-[1.05rem] leading-8 text-[#f5f4f1]/78 text-pretty sm:text-[1.1rem] [&>*+*]:mt-[1.15em] [&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-white/58 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:text-white/92 [&_h2]:text-white/92 [&_h3]:text-white/92 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold [&_strong]:text-white/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
    </article>
  );
}

function GameRailItem({
  game,
  locale,
  active = false,
  label,
}: {
  game: TextGameSummary | TextGameDetail;
  locale: Locale;
  active?: boolean;
  label?: string;
}) {
  const isDetail = "content" in game;
  const gameId = game.gameId;
  const name = isDetail ? game.content.name : game.name;
  const posterUrl = isDetail ? game.content.posterUrl : game.posterUrl;
  return (
    <Link
      href={localizePath(`/play/text-game/${encodeURIComponent(gameId)}`, locale)}
      className={`mb-1 flex items-center gap-3 rounded-xl p-2.5 transition-colors ${
        active ? "bg-white/8" : "hover:bg-white/5"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-white/6">
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt=""
            fill
            unoptimized
            priority={active}
            sizes="44px"
            className="object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white/82">{name}</p>
        {label ? <p className="mt-1 text-[11px] text-white/34">{label}</p> : null}
      </div>
    </Link>
  );
}

function InfoRail({
  game,
  activeStill,
  stillIndex,
  stillCount,
  onPrevious,
  onNext,
  soundPlaying,
  hasSound,
  onToggleSound,
  t,
}: {
  game: TextGameDetail;
  activeStill: string | null;
  stillIndex: number;
  stillCount: number;
  onPrevious: () => void;
  onNext: () => void;
  soundPlaying: boolean;
  hasSound: boolean;
  onToggleSound: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const content = game.content;
  return (
    <div className="px-5 py-5">
      {activeStill ? (
        <div className="group relative aspect-video overflow-hidden rounded-2xl bg-white/6">
          <Image
            src={activeStill}
            alt={t("stillAlt", { index: stillIndex + 1 })}
            fill
            unoptimized
            priority
            sizes="340px"
            className="object-cover"
          />
          {stillCount > 1 ? (
            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between">
              <Button
                variant="ghost"
                color="muted"
                size="icon-sm"
                className="bg-black/52 text-white hover:bg-black/68"
                onClick={onPrevious}
                aria-label={t("previousStill")}
              >
                <IconChevronLeft className="size-4" />
              </Button>
              <span className="rounded-full bg-black/52 px-2 py-1 text-[10px] text-white/68">
                {stillIndex + 1} / {stillCount}
              </span>
              <Button
                variant="ghost"
                color="muted"
                size="icon-sm"
                className="bg-black/52 text-white hover:bg-black/68"
                onClick={onNext}
                aria-label={t("nextStill")}
              >
                <IconChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : content.posterUrl ? (
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-white/6">
          <Image
            src={content.posterUrl}
            alt=""
            fill
            unoptimized
            priority
            sizes="340px"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="mt-5">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-white/34 uppercase">
          {t("workInformation")}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
          {content.name || t("untitled")}
        </h2>
        {content.synopsis ? (
          <p className="mt-3 text-sm leading-6 text-white/48">{content.synopsis}</p>
        ) : null}
      </div>

      {hasSound ? (
        <button
          type="button"
          onClick={onToggleSound}
          className="mt-5 flex w-full items-center gap-3 rounded-xl bg-white/5 px-3 py-3 text-left transition-colors hover:bg-white/8"
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/7 text-white/68">
            {soundPlaying ? <IconMusic className="size-4" /> : <IconMusicOff className="size-4" />}
          </span>
          <span>
            <span className="block text-sm font-medium text-white/76">{t("soundtrack")}</span>
            <span className="mt-0.5 block text-xs text-white/34">
              {soundPlaying ? t("soundtrackPlaying") : t("soundtrackPaused")}
            </span>
          </span>
        </button>
      ) : null}

      {content.characters.length > 0 ? (
        <section className="mt-7" aria-labelledby="reader-cast">
          <h3 id="reader-cast" className="text-xs font-semibold text-white/58">
            {t("cast")}
          </h3>
          <div className="mt-3 space-y-3">
            {content.characters.map((character) => (
              <div key={character.id} className="flex items-start gap-3">
                <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-white/6">
                  {character.avatarUrl ? (
                    <Image
                      src={character.avatarUrl}
                      alt=""
                      fill
                      unoptimized
                      sizes="40px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-white/38">
                      <IconUser className="size-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="truncate text-sm font-medium text-white/76">{character.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-white/36">
                    {character.intro}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-7 flex items-center gap-2 text-xs text-white/30">
        <IconHistory className="size-4" />
        {t("progressSaved")}
      </div>
    </div>
  );
}
