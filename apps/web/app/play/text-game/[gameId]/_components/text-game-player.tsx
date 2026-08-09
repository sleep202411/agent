"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconBrush,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFlag,
  IconHistory,
  IconInfoCircle,
  IconLibrary,
  IconLoader2,
  IconMessagePlus,
  IconMicrophone,
  IconMusic,
  IconMusicOff,
  IconRefresh,
  IconSend2,
  IconShare3,
  IconSparkles,
  IconThumbDown,
  IconThumbUp,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type StoryModelId = "qwen" | "kimi" | "deepseek" | "glm";

const STORY_MODELS: StoryModelId[] = ["qwen", "kimi", "deepseek", "glm"];

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
  const [selectedModel, setSelectedModel] = useState<StoryModelId>("qwen");
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  const [soundNeedsActivation, setSoundNeedsActivation] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayAttemptedUrlRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef(false);
  const restartingRef = useRef(false);
  const content = game.content;

  const sessionQuery = useQuery({
    queryKey: playerTextGameKeys.session(game.gameId),
    queryFn: () => loadOrStartTextGameSession(game.gameId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const session = sessionQuery.data;
  const stills = session ? session.stillUrls : content.stillUrls;
  const bgmUrl = session ? session.bgmUrl : content.bgmUrl;

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
    if (!audio || !bgmUrl) {
      autoplayAttemptedUrlRef.current = null;
      setSoundNeedsActivation(false);
      setSoundPlaying(false);
      return;
    }
    audio.volume = 0.35;
    if (autoplayAttemptedUrlRef.current === bgmUrl) return;
    autoplayAttemptedUrlRef.current = bgmUrl;

    let cancelled = false;
    void audio.play().then(
      () => {
        if (!cancelled) setSoundNeedsActivation(false);
      },
      () => {
        if (cancelled) return;
        setSoundPlaying(false);
        setSoundNeedsActivation(true);
      }
    );
    return () => {
      cancelled = true;
    };
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
        setSoundNeedsActivation(false);
        setSoundPlaying(true);
      } catch (error) {
        setSoundNeedsActivation(true);
        toast.error(error instanceof Error ? error.message : t("soundUnavailable"));
      }
    } else {
      audio.pause();
      setSoundNeedsActivation(false);
      setSoundPlaying(false);
    }
  }, [t]);

  async function submitAction() {
    const value = draft.trim();
    if (!value || !session || sendingRef.current || restartingRef.current) return;

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
    if (!session || restartingRef.current || sendingRef.current) return;
    restartingRef.current = true;
    setRestarting(true);
    const toastId = toast.loading(t("restartingStory"));
    try {
      const next = await startTextGameSession(game.gameId);
      queryClient.setQueryData(playerTextGameKeys.session(game.gameId), next);
      setDraft("");
      setStillIndex(0);
      toast.success(t("restartComplete"), { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("restartFailed"), { id: toastId });
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

  async function shareStory() {
    const shareData = {
      title: content.name || t("untitled"),
      text: content.synopsis || t("shareDescription"),
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        toast.success(t("linkCopied"));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : t("shareFailed"));
    }
  }

  function showComingSoon() {
    toast.info(t("comingSoon"));
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
                size={soundNeedsActivation ? "sm" : "icon"}
                className={
                  soundNeedsActivation
                    ? "rounded-full bg-white/8 px-3 text-white/76 hover:bg-white/12 hover:text-white"
                    : "text-white/58 hover:bg-white/8 hover:text-white"
                }
                onClick={() => void toggleSound()}
                aria-label={
                  soundNeedsActivation
                    ? t("enableSoundtrack")
                    : soundPlaying
                      ? t("pauseSoundtrack")
                      : t("playSoundtrack")
                }
              >
                {soundNeedsActivation ? (
                  <>
                    <IconMusic className="size-4" />
                    <span>{t("enableSoundtrack")}</span>
                  </>
                ) : soundPlaying ? (
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
                  className="text-white/58 hover:bg-white/8 hover:text-white min-[1120px]:hidden"
                  aria-label={t("restart")}
                  disabled={!session || restarting || sending}
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
                  <AlertDialogAction
                    disabled={!session || restarting || sending}
                    onClick={() => void restart()}
                  >
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
            <div className="mb-10 grid gap-5 border-b border-white/8 pb-8 text-left sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center sm:gap-7">
              <div className="relative aspect-[2/3] w-36 overflow-hidden rounded-xl bg-white/6 ring-1 ring-white/10 sm:w-full">
                {content.posterUrl ? (
                  <Image
                    src={content.posterUrl}
                    alt=""
                    fill
                    unoptimized
                    sizes="(min-width: 640px) 160px, 144px"
                    className="object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center text-white/30">
                    <IconLibrary className="size-7" />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-white/34 uppercase">
                  {t("interactiveFiction")}
                </p>
                <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white/94 sm:text-3xl">
                  {content.name || t("untitled")}
                </h1>
                {content.synopsis ? (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/48 sm:text-[15px]">
                    {content.synopsis}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/34">
                  <span className="inline-flex items-center gap-1.5">
                    <IconUser className="size-3.5" />
                    {t("characterCount", { count: content.characters.length })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <IconHistory className="size-3.5" />
                    {sessionQuery.isLoading
                      ? t("openingStory")
                      : session?.resumed
                        ? t("resumedSession")
                        : t("newSession")}
                  </span>
                </div>
              </div>
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
              disabled={!session || sending || restarting}
              placeholder={t("actionPlaceholder")}
              aria-label={t("actionPlaceholder")}
              className="min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-5 text-white outline-none placeholder:text-white/28 disabled:opacity-50"
            />
            <Button
              size="icon-lg"
              className="size-10 rounded-xl"
              disabled={!draft.trim() || !session || sending || restarting}
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
          soundNeedsActivation={soundNeedsActivation}
          hasSound={Boolean(bgmUrl)}
          onToggleSound={() => void toggleSound()}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          reaction={reaction}
          onReaction={(nextReaction) =>
            setReaction((current) => (current === nextReaction ? null : nextReaction))
          }
          onShare={() => void shareStory()}
          onComingSoon={showComingSoon}
          onRestart={() => void restart()}
          restartDisabled={!session || restarting || sending}
          restarting={restarting}
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
        <SheetContent
          side="right"
          className="w-[min(360px,calc(100vw-24px))] border-white/8 bg-[#131416] p-0 text-white ring-white/10 sm:max-w-[360px]"
        >
          <SheetHeader className="absolute top-3 right-3 z-20 border-0 p-0 [&_[data-slot=sheet-close]]:bg-black/32 [&_[data-slot=sheet-close]]:text-white/64 [&_[data-slot=sheet-close]]:backdrop-blur-sm [&_[data-slot=sheet-close]]:hover:bg-black/52 [&_[data-slot=sheet-close]]:hover:text-white">
            <SheetTitle className="sr-only">{content.name || t("untitled")}</SheetTitle>
            <SheetDescription className="sr-only">{t("workInformation")}</SheetDescription>
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
              soundNeedsActivation={soundNeedsActivation}
              hasSound={Boolean(bgmUrl)}
              onToggleSound={() => void toggleSound()}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              reaction={reaction}
              onReaction={(nextReaction) =>
                setReaction((current) => (current === nextReaction ? null : nextReaction))
              }
              onShare={() => void shareStory()}
              onComingSoon={showComingSoon}
              onRestart={() => void restart()}
              restartDisabled={!session || restarting || sending}
              restarting={restarting}
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
    <article className="text-[1.05rem] leading-8 text-[#f5f4f1]/78 text-pretty sm:text-[1.1rem] [&>*+*]:mt-[1.15em] [&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-white/58 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:text-white/92 [&_h2]:text-white/92 [&_h3]:text-white/92 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_strong]:font-semibold [&_strong]:text-white/90">
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
      <div className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-lg bg-white/6">
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt=""
            fill
            unoptimized
            priority={active}
            sizes="48px"
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
  soundNeedsActivation,
  hasSound,
  onToggleSound,
  selectedModel,
  onModelChange,
  reaction,
  onReaction,
  onShare,
  onComingSoon,
  onRestart,
  restartDisabled,
  restarting,
  t,
}: {
  game: TextGameDetail;
  activeStill: string | null;
  stillIndex: number;
  stillCount: number;
  onPrevious: () => void;
  onNext: () => void;
  soundPlaying: boolean;
  soundNeedsActivation: boolean;
  hasSound: boolean;
  onToggleSound: () => void;
  selectedModel: StoryModelId;
  onModelChange: (model: StoryModelId) => void;
  reaction: "like" | "dislike" | null;
  onReaction: (reaction: "like" | "dislike") => void;
  onShare: () => void;
  onComingSoon: () => void;
  onRestart: () => void;
  restartDisabled: boolean;
  restarting: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const content = game.content;

  return (
    <div className="flex min-h-full flex-col px-4 py-5">
      <section aria-labelledby="reader-world-title">
        <div className="relative aspect-[2/3] w-40 overflow-hidden rounded-xl bg-white/7 ring-1 ring-white/10">
          {content.posterUrl ? (
            <Image
              src={content.posterUrl}
              alt=""
              fill
              unoptimized
              priority
              sizes="160px"
              className="object-cover"
            />
          ) : (
            <div className="grid size-full place-items-center text-white/36">
              <IconLibrary className="size-6" />
            </div>
          )}
        </div>
        <div className="mt-3 min-w-0">
          <h2
            id="reader-world-title"
            className="truncate text-[15px] font-semibold tracking-[-0.015em] text-white/92"
          >
            {content.name || t("untitled")}
          </h2>
          <p className="mt-0.5 text-xs text-white/42">{t("interactiveFiction")}</p>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <RailActionButton label={t("share")} onClick={onShare}>
            <IconShare3 className="size-4" />
          </RailActionButton>
          <div className="flex h-9 items-center rounded-full bg-white/5 ring-1 ring-white/10">
            <button
              type="button"
              aria-label={t("like")}
              aria-pressed={reaction === "like"}
              onClick={() => onReaction("like")}
              className={`grid h-full w-10 place-items-center rounded-l-full transition-colors hover:bg-white/8 hover:text-white ${
                reaction === "like" ? "text-white" : "text-white/52"
              }`}
            >
              <IconThumbUp className="size-4" />
            </button>
            <span aria-hidden className="h-4 w-px bg-white/9" />
            <button
              type="button"
              aria-label={t("dislike")}
              aria-pressed={reaction === "dislike"}
              onClick={() => onReaction("dislike")}
              className={`grid h-full w-10 place-items-center rounded-r-full transition-colors hover:bg-white/8 hover:text-white ${
                reaction === "dislike" ? "text-white" : "text-white/52"
              }`}
            >
              <IconThumbDown className="size-4" />
            </button>
          </div>
          <div className="ml-auto">
            <RailActionButton label={t("report")} onClick={onComingSoon}>
              <IconFlag className="size-4" />
            </RailActionButton>
          </div>
        </div>

        {content.synopsis ? (
          <p className="mt-4 line-clamp-3 text-xs leading-5 text-white/48">{content.synopsis}</p>
        ) : null}
      </section>

      <div className="my-4 h-px bg-white/8" />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={restartDisabled}
            className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-white/6 px-4 text-sm font-medium text-white/78 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
          >
            {restarting ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconMessagePlus className="size-4" />
            )}
            {t("newStoryAction")}
          </button>
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
            <AlertDialogAction disabled={restartDisabled} onClick={onRestart}>
              {t("restart")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <nav className="mt-4 space-y-0.5" aria-label={t("storyControls")}>
        <RailMenuButton
          icon={<IconMicrophone className="size-4" />}
          label={t("voice")}
          value={t("comingSoon")}
          onClick={onComingSoon}
        />
        <RailMenuButton
          icon={<IconHistory className="size-4" />}
          label={t("history")}
          value={t("comingSoon")}
          onClick={onComingSoon}
        />
        <RailMenuButton
          icon={<IconBrush className="size-4" />}
          label={t("customize")}
          value={t("comingSoon")}
          onClick={onComingSoon}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-white/6"
            >
              <span className="grid size-8 shrink-0 place-items-center text-white/56">
                <IconSparkles className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium text-white/74">{t("model")}</span>
              <span className="max-w-24 truncate text-xs text-white/36">
                {t(`models.${selectedModel}`)}
              </span>
              <IconChevronRight className="size-4 shrink-0 text-white/28 transition-transform group-data-[state=open]:rotate-90" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="left"
            sideOffset={8}
            className="min-w-44 border-0 bg-[#242529] p-1.5 text-white shadow-2xl ring-white/10"
          >
            <DropdownMenuRadioGroup
              value={selectedModel}
              onValueChange={(value) => onModelChange(value as StoryModelId)}
            >
              {STORY_MODELS.map((model) => (
                <DropdownMenuRadioItem
                  key={model}
                  value={model}
                  className="min-h-9 rounded-lg px-3 text-sm text-white/72 focus:bg-white/8 focus:text-white"
                >
                  {t(`models.${model}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {hasSound ? (
          <RailMenuButton
            icon={
              soundPlaying ? <IconMusic className="size-4" /> : <IconMusicOff className="size-4" />
            }
            label={t("soundtrack")}
            value={
              soundNeedsActivation
                ? t("soundtrackNeedsActivation")
                : soundPlaying
                  ? t("soundtrackPlaying")
                  : t("soundtrackPaused")
            }
            onClick={onToggleSound}
          />
        ) : null}
      </nav>

      {activeStill ? (
        <section className="mt-6" aria-labelledby="reader-current-scene">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="reader-current-scene" className="text-xs font-semibold text-white/58">
              {t("currentScene")}
            </h3>
            {stillCount > 1 ? (
              <span className="text-[11px] text-white/30">
                {stillIndex + 1} / {stillCount}
              </span>
            ) : null}
          </div>
          <div className="group relative aspect-video overflow-hidden rounded-xl bg-white/6">
            <Image
              src={activeStill}
              alt={t("stillAlt", { index: stillIndex + 1 })}
              fill
              unoptimized
              sizes="288px"
              className="object-cover"
            />
            {stillCount > 1 ? (
              <div className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 items-center justify-between opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-sm"
                  className="bg-black/55 text-white hover:bg-black/72"
                  onClick={onPrevious}
                  aria-label={t("previousStill")}
                >
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-sm"
                  className="bg-black/55 text-white hover:bg-black/72"
                  onClick={onNext}
                  aria-label={t("nextStill")}
                >
                  <IconChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {content.characters.length > 0 ? (
        <section className="mt-6" aria-labelledby="reader-cast">
          <div className="flex items-center justify-between">
            <h3 id="reader-cast" className="text-xs font-semibold text-white/58">
              {t("cast")}
            </h3>
            <span className="text-[11px] text-white/30">{content.characters.length}</span>
          </div>
          <div className="mt-2 space-y-0.5">
            {content.characters.map((character) => (
              <div
                key={character.id}
                className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/4"
              >
                <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-white/6 ring-1 ring-white/8">
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
                    <div className="grid size-full place-items-center text-white/34">
                      <IconUser className="size-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="truncate text-sm font-medium text-white/76">{character.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-[1.15rem] text-white/34">
                    {character.intro}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-auto flex items-center gap-2 px-2 pt-8 text-[11px] text-white/26">
        <IconCheck className="size-3.5" />
        {t("progressSaved")}
      </div>
    </div>
  );
}

function RailActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full bg-white/5 text-white/52 ring-1 ring-white/10 transition-colors hover:bg-white/9 hover:text-white"
    >
      {children}
    </button>
  );
}

function RailMenuButton({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-white/6"
    >
      <span className="grid size-8 shrink-0 place-items-center text-white/56">{icon}</span>
      <span className="min-w-0 flex-1 text-sm font-medium text-white/74">{label}</span>
      <span className="max-w-24 truncate text-xs text-white/34">{value}</span>
      <IconChevronRight className="size-4 shrink-0 text-white/28 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
