import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { focusManager, QueryObserver } from "@tanstack/react-query";
import { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import * as Renderer from "@deepseek-ai/dsh-client-ui-renderer/client";
import * as UiSession from "@deepseek-ai/dsh-client-ui-session/client";
import * as Conversation from "@deepseek-ai/dsh-client-ui-conversation/client";
import * as InputTrigger from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import * as Commands from "@deepseek-ai/dsh-client-ui-commands/client";
import * as Chat from "@deepseek-ai/dsh-client-ui-chat/client";
import * as Locale from "@deepseek-ai/dsh-client-locale/client";
import * as Theme from "@deepseek-ai/dsh-client-ui-theme/client";
import { Button, Menu, closeTopModal, modalSelector } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  IconArrowRight,
  IconBolt,
  IconClock,
  IconChevronDown,
  IconLoader2,
  IconPhoto,
  IconPlayerPlay,
  IconFileText,
  IconVideo,
  IconAlertCircle,
  IconChevronLeft,
  IconDownload,
  IconShare,
  IconPlayerStop,
} from "@tabler/icons-react";

import { projectHistory, storyMediaDefinition, videoProgress } from "./events";
import * as Layout from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import * as Workspace from "@deepseek-ai/dsh-client-ui-workspace/client";
import * as SidebarRight from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import * as Attachment from "@deepseek-ai/dsh-client-ui-attachment/client";
import * as Resources from "@deepseek-ai/dsh-client-resources/client";
import * as SettingsGeneral from "@deepseek-ai/dsh-client-ui-settings-general/client";
import ShortcutsService from "@deepseek-ai/dsh-client-shortcuts/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { storyPreferences, useStoryLocale } from "./preferences";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  StoryOutputs,
  StoryScript,
  StoryRun,
  StoryVideoModels,
} from "@repo/app-story-protocol";
import {
  StoryTransport,
  copy,
  isActive,
  resumeAuthorization,
  storyErrorMessage,
} from "./transport";
import { createStorySession } from "./session";

const StoryPlayer = lazy(() => import("./player"));

function NativeResourceActions({
  transport,
  media,
  runId,
}: {
  transport: StoryTransport;
  media: StoryOutputs[number];
  runId?: string;
}) {
  const bridge = transport.bridge;
  const locale = useStoryLocale(transport);
  const t = copy(locale).h5;
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string>();
  if (
    !bridge ||
    !media.url ||
    media.status !== "ready" ||
    !(bridge.supports("saveResource") || bridge.supports("shareResource"))
  )
    return null;
  const act = async (action: "saveResource" | "shareResource") => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      await bridge.resource(action, {
        projectId: transport.context.projectId!,
        chapterId: transport.context.chapterId!,
        ...(runId ? { runId } : {}),
        resource: {
          id: media.id,
          kind: media.kind,
          name: (media.title || t.mediaPanel).slice(0, 512),
          url: media.url!,
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <div className="story-resource-actions" aria-busy={pending}>
      {bridge.supports("saveResource") && (
        <Button disabled={pending} onClick={() => void act("saveResource")}>
          <IconDownload size={16} aria-hidden="true" />
          {t.saveResource}
        </Button>
      )}
      {bridge.supports("shareResource") && (
        <Button disabled={pending} onClick={() => void act("shareResource")}>
          <IconShare size={16} aria-hidden="true" />
          {t.shareResource}
        </Button>
      )}
      {error && (
        <p role="alert" className="story-error">
          {error}
        </p>
      )}
    </div>
  );
}

function VideoModelChoice({
  transport,
  run,
  disabled,
  onChange,
}: {
  transport: StoryTransport;
  run: StoryRun;
  disabled: boolean;
  onChange: (modelId: string) => void;
}) {
  const locale = useStoryLocale(transport);
  const t = copy(locale).h5;
  const [open, setOpen] = useState(false);
  const observer = useMemo(
    () =>
      new QueryObserver<StoryVideoModels>(transport.queries, {
        queryKey: ["story-agent-video-models", transport.context.projectId, run.id],
        queryFn: ({ signal }) => transport.videoModels(run.id, signal),
      }),
    [transport, run.id]
  );
  const subscribe = useMemo(() => observer.subscribe.bind(observer), [observer]);
  const result = useSyncExternalStore(subscribe, () => observer.getCurrentResult());
  useEffect(() => () => observer.destroy(), [observer]);
  const selected = run.mediaQuote?.videoModelId ?? result.data?.selectedModelId;
  return (
    <div className="story-video-model">
      <span>{t.quoteVideoModel}</span>
      <Menu
        open={open && !disabled}
        portal
        align="end"
        selectedId={selected}
        onClose={() => setOpen(false)}
        items={result.data?.models.map((model) => ({ id: model.id, label: model.name }))}
        onSelect={(id) => {
          setOpen(false);
          if (id !== selected) onChange(id);
        }}
        anchor={
          <Button
            disabled={disabled || !result.data}
            onClick={() => setOpen(!open)}
            aria-label={t.quoteVideoModel}
            aria-haspopup="menu"
            aria-expanded={open && !disabled}
          >
            {result.data?.models.find((model) => model.id === selected)?.name ??
              selected ??
              t.quoteLoadingModels}
            <IconChevronDown size={16} aria-hidden="true" />
          </Button>
        }
      />
      {result.error && (
        <p role="alert" className="story-error">
          {result.error.message}
        </p>
      )}
    </div>
  );
}

type StoryPanel = "story-script" | "story-media" | "story-player";

function ResultCard({
  run,
  latest,
  onOpen,
  title,
  children,
  transport,
}: {
  run: StoryRun;
  latest: boolean;
  onOpen: (panel: StoryPanel) => void;
  transport: StoryTransport;
  title?: string;
  children?: React.ReactNode;
}) {
  const locale = useStoryLocale(transport);
  const t = copy(locale).h5;
  const playable =
    run.status === "completed" &&
    run.result?.previewPath ===
      `/play/story-preview/${transport.context.projectId}?chapterId=${run.chapterId}`;
  const showMedia = run.result?.kind !== "script" && run.chapterId === transport.context.chapterId;
  return (
    <article className="story-production story-result">
      <h3>{run.result?.title ?? title}</h3>
      {children}
      {latest && run.result && (run.result.kind === "script" || playable || showMedia) && (
        <div className="story-result-actions">
          {run.result?.kind === "script" && (
            <Button
              type="button"
              variant="primary"
              className="story-result-primary"
              onClick={() => onOpen("story-script")}
            >
              <IconFileText size={18} aria-hidden="true" />
              {t.resultViewScript}
            </Button>
          )}
          {playable && (
            <Button
              type="button"
              variant="primary"
              className="story-result-primary"
              onClick={() => onOpen("story-player")}
            >
              <IconPlayerPlay size={18} aria-hidden="true" />
              {run.result?.kind === "interactive_film" ? t.resultPlayStory : t.resultPlayVideo}
            </Button>
          )}
          {showMedia && (
            <Button
              type="button"
              className="story-result-secondary"
              onClick={() => onOpen("story-media")}
            >
              <IconPhoto size={18} aria-hidden="true" />
              {t.resultViewMedia}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function MediaOutputs({
  transport,
  active,
  run,
  latest = false,
  onOpen,
}: {
  transport: StoryTransport;
  active: boolean;
  run?: StoryRun;
  latest?: boolean;
  onOpen?: (panel: StoryPanel) => void;
}) {
  const locale = useStoryLocale(transport);
  const t = copy(locale).h5;
  const runId = run?.id;
  const observer = useMemo(
    () =>
      new QueryObserver<StoryOutputs>(transport.queries, {
        queryKey: [
          "story-agent-outputs",
          transport.context.projectId,
          transport.context.chapterId,
          runId,
        ],
        queryFn: ({ signal }) => transport.outputs(signal, runId),
        refetchInterval: active ? 2000 : false,
      }),
    [transport, active, runId]
  );
  const subscribe = useMemo(() => observer.subscribe.bind(observer), [observer]);
  const result = useSyncExternalStore(subscribe, () => observer.getCurrentResult());
  useEffect(() => () => observer.destroy(), [observer]);
  const progress = videoProgress(result.data ?? []);
  const completedResult = run?.status === "completed" && run.result && run.result.kind !== "script";
  const poster =
    progress.current?.posterUrl ?? progress.videos.find((media) => media.posterUrl)?.posterUrl;
  const progressLabel =
    progress.totalMs !== null
      ? t.videoProgressSeconds
          .replace(
            "{completed}",
            new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
              progress.completedMs! / 1000
            )
          )
          .replace(
            "{total}",
            new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
              progress.totalMs / 1000
            )
          )
      : t.videoProgressClips
          .replace("{completed}", String(progress.completedCount))
          .replace("{total}", String(progress.videos.length));
  const progressState =
    run?.status === "cancelled" || run?.status === "cancelling"
      ? t.videoStopped
      : run?.status === "failed" || progress.videos.some((media) => media.status === "failed")
        ? t.mediaFailed
        : run?.status === "blocked"
          ? t.videoPaused
          : completedResult
            ? t.completed
            : progress.current?.status === "generating"
              ? t.mediaGeneratingVideo
              : progress.current?.status === "queued"
                ? t.mediaQueued
                : t.videoVerifying;
  return (
    <div className={runId ? "story-media story-media-transcript" : "story-media"}>
      {result.error && (
        <p role="alert" className="story-error">
          {result.error.message}
        </p>
      )}
      {result.data
        ?.filter((media) => !run || media.kind === "image")
        .map((media) => (
          <figure key={media.id}>
            <figcaption>
              {media.kind === "image" ? (
                <IconPhoto size={16} aria-hidden="true" />
              ) : (
                <IconVideo size={16} aria-hidden="true" />
              )}
              {media.title}
            </figcaption>
            <div
              className="story-media-body"
              aria-busy={["queued", "generating"].includes(media.status)}
            >
              {media.status === "ready" && media.url ? (
                media.kind === "image" ? (
                  <img src={media.url} alt={media.title} loading="lazy" />
                ) : (
                  <video
                    src={media.url}
                    poster={media.posterUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={media.title}
                  />
                )
              ) : (
                <div className="story-media-placeholder">
                  {media.posterUrl && (
                    <img className="story-media-reference" src={media.posterUrl} alt="" />
                  )}
                  <div className="story-media-state" role="status">
                    {media.status === "generating" ? (
                      <IconLoader2 size={24} className="story-quote-spinner" aria-hidden="true" />
                    ) : media.status === "failed" ? (
                      <IconAlertCircle size={24} aria-hidden="true" />
                    ) : media.kind === "image" ? (
                      <IconPhoto size={28} aria-hidden="true" />
                    ) : (
                      <IconVideo size={28} aria-hidden="true" />
                    )}
                    <span>
                      {media.status === "queued"
                        ? t.mediaQueued
                        : media.status === "cancelled"
                          ? t.mediaCancelled
                          : media.status === "failed"
                            ? t.mediaFailed
                            : media.kind === "image"
                              ? t.mediaGeneratingImage
                              : t.mediaGeneratingVideo}
                    </span>
                    {media.posterUrl && <small>{t.mediaReferencePreview}</small>}
                  </div>
                </div>
              )}
            </div>
            <NativeResourceActions transport={transport} media={media} runId={runId} />
            {media.error && (
              <details className="story-media-error">
                <summary>{t.mediaErrorDetails}</summary>
                <p>{media.error}</p>
              </details>
            )}
          </figure>
        ))}
      {run && onOpen && (progress.videos.length > 0 || completedResult) && (
        <ResultCard
          run={run}
          transport={transport}
          latest={latest}
          onOpen={onOpen}
          title={t.videoProduction}
        >
          {poster && (
            <div className="story-film-preview">
              <img src={poster} alt="" loading="lazy" />
              {!completedResult && <span>{t.mediaReferencePreview}</span>}
            </div>
          )}
          {progress.videos.length > 0 && (
            <div className="story-film-progress">
              <div role="status" className="story-film-state">
                {active && (
                  <IconLoader2 size={16} className="story-quote-spinner" aria-hidden="true" />
                )}
                <span>{progressState}</span>
              </div>
              <progress
                aria-label={t.videoProduction}
                max={progress.totalMs ?? progress.videos.length}
                value={progress.completedMs ?? progress.completedCount}
              />
              <p className="story-film-total">{progressLabel}</p>
              {progress.current && (
                <p>{t.videoCurrentScene.replace("{title}", progress.current.title)}</p>
              )}
              <p className="story-film-note">{t.videoProgressScope}</p>
              {progress.videos
                .filter((media) => media.error)
                .map((media) => (
                  <details key={media.id} className="story-media-error">
                    <summary>{t.mediaErrorDetails}</summary>
                    <p>
                      {media.title}: {media.error}
                    </p>
                  </details>
                ))}
            </div>
          )}
        </ResultCard>
      )}
    </div>
  );
}

function ScriptOutput({ transport, title }: { transport: StoryTransport; title: string }) {
  const t = copy(useStoryLocale(transport)).h5;
  const observer = useMemo(
    () =>
      new QueryObserver<StoryScript>(transport.queries, {
        queryKey: ["story-agent-script", transport.context.projectId, transport.context.chapterId],
        queryFn: ({ signal }) => transport.script(signal),
      }),
    [transport]
  );
  const subscribe = useMemo(() => observer.subscribe.bind(observer), [observer]);
  const result = useSyncExternalStore(subscribe, () => observer.getCurrentResult());
  useEffect(() => () => observer.destroy(), [observer]);
  const error =
    result.error?.message ?? (result.isSuccess && !result.data ? t.scriptUnavailable : undefined);
  return (
    <div className="story-script" aria-busy={result.isPending}>
      {error && (
        <p role="alert" className="story-error">
          {error}
        </p>
      )}
      {result.data?.document.blocks.map((block, index) =>
        index === 0 &&
        block.kind === "heading" &&
        block.level === 1 &&
        block.text === title ? null : block.kind === "heading" ? (
          React.createElement(`h${block.level + 2}`, { key: index }, block.text)
        ) : (
          <p key={index}>{block.text}</p>
        )
      )}
    </div>
  );
}

export async function mountStoryAgent(container: HTMLElement, transport: StoryTransport) {
  const ctx = new Context();
  try {
    const preferences = storyPreferences(
      transport.context.projectId ?? "unconfigured",
      transport.context.locale
    );
    ctx.reflect.provide("configForms", preferences);
    const { sessions, transportFor, initialId, activate } = createStorySession(ctx, transport);
    const remote = {
      session: {},
      directoryPicker: {},
      settings: {},
      commands: {
        list: async () => ({ ok: true, value: [] }),
      },
      $host: { isLoopback: false },
      $on(event: string, listener: (id: string, running: boolean) => void) {
        if (event !== "api-session/status") return () => {};
        return transport.history.subscribe(({ data }) => {
          for (const row of transport.conversations.getCurrentResult().data ?? [])
            listener(
              row.id,
              Boolean(data?.runs.some((run) => run.chapterId === row.id && isActive(run)))
            );
        });
      },
    };
    ctx.reflect.provide("remote", remote);
    ctx.reflect.provide("remote.session", remote.session);
    ctx.reflect.provide("remote.commands", remote.commands);
    ctx.reflect.provide("remote.directoryPicker", remote.directoryPicker);
    ctx.reflect.provide("remote.settings", remote.settings);
    const connectionState = createSnapshotStore({ state: "connected", ready: true });
    ctx.reflect.provide("connection", {
      state: connectionState,
      reconnect: () => transport.history.refetch(),
    });
    ctx.reflect.provide("fileUpload", {
      async upload(
        sessionId: SessionId,
        data: Blob | Uint8Array | ReadableStream<Uint8Array>,
        name = "reference.txt",
        signal?: AbortSignal,
        onProgress?: (progress: { loaded: number; total?: number }) => void
      ) {
        try {
          const blob =
            data instanceof Blob
              ? data
              : data instanceof Uint8Array
                ? new Blob([Uint8Array.from(data)])
                : await new Response(data).blob();
          const row = await transportFor(sessionId).upload(blob, name, signal, onProgress);
          return {
            ok: true,
            value: {
              receiptId: row.id,
              file: { attachmentId: row.hash, name: row.name, bytes: row.bytes },
            },
          };
        } catch (error) {
          return {
            ok: false,
            error: {
              code: "gateway/internal",
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          };
        }
      },
    });
    await ctx.plugin(Renderer).await();
    await ctx.plugin(UiSession).await();
    await ctx.plugin(Locale).await();
    transport.bindDisplayLanguage(ctx.locale);
    const locales = ["en-US", "zh-CN", "zh-HK"] as const;
    for (const locale of locales) {
      ctx.locale.addLanguage({
        id: locale,
        label: locale,
        fallback: locale === "en-US" ? "en" : "zh",
      });
      const localized = copy(locale);
      ctx.effect(() =>
        ctx.locale.register("conversation", locale, {
          "placeholder.default": localized.h5.input,
          "placeholder.hero": localized.h5.input,
          "hero.headline": localized.h5.welcomeTitle,
          "hero.preview": "",
        })
      );
    }
    // Harness's built-in language choices must resolve through our product
    // language packs, including when the page was opened in another language.
    ctx.on("locale/change", ({ active }) => {
      if (active === "en" || active === "zh")
        ctx.locale.setLocale(active === "en" ? "en-US" : "zh-CN");
    });
    // The official status footer presents the current business phase. Keep a
    // single indicator and retain Harness's real running state/stop behavior.
    const phases = {
      planning: "planning",
      script: "script",
      plot: "plot",
      assets: "assets",
      asset_media: "assetMedia",
      storyboard: "storyboard",
      clip_media: "clipMedia",
      verify: "verify",
    } as const;
    let statusPhase: string | undefined;
    let removeStatus: (() => void) | undefined;
    const updateStatus = () => {
      const active = transport.history.getCurrentResult().data?.runs.find(isActive);
      const phase = active?.status === "cancelling" ? "stopping" : active?.phase;
      if (phase === statusPhase && removeStatus) return;
      removeStatus?.();
      const removals = locales.map((locale) => {
        const localized = copy(locale);
        const key = phases[phase as keyof typeof phases];
        const label =
          phase === "stopping"
            ? localized.app.stopping
            : key
              ? localized.app[key]
              : localized.h5.processing;
        return ctx.locale.register("chat", locale, {
          "chat.deepDiving": label,
          "chat.deepDivingFor": localized.h5.runningFor.replace("{status}", label),
          "message.failure.accountSignedOut": localized.h5.sessionExpired,
          "message.failure.accountSignInRequired": localized.h5.sessionRequired,
        });
      });
      removeStatus = () => removals.forEach((remove) => remove());
      statusPhase = phase;
    };
    ctx.effect(() => transport.history.subscribe(updateStatus));
    ctx.effect(() => () => removeStatus?.());
    updateStatus();
    ctx.locale.setLocale(transport.displayLocale);
    await ctx.plugin(Theme).await();
    await ctx.plugin(ShortcutsService).await();
    await ctx.plugin(Layout).await();
    await ctx.plugin(Resources).await();
    await ctx.plugin(SidebarRight).await();
    await ctx.plugin(Workspace).await();
    await ctx.plugin(SettingsGeneral).await();
    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        { name: "shell.overlay", id: "story-document-title" },
        function ProductTitle({ useSessions }: PropsRuntime<"shell.overlay">) {
          const title = useSessions(
            (state) =>
              Object.values(state.byId).find((row) => (row.retainedBy.mainView ?? 0) > 0)
                ?.displayTitle
          );
          useEffect(() => {
            document.title = title ? `${title} — FizzDragon` : "FizzDragon";
          }, [title]);
          return null;
        }
      )
    );
    // This embedded surface has one selected project; the official conversation and right pane remain intact.
    const closeSidebar = ctx.layout.toggleSidebar.bind(ctx.layout);
    ctx.slots.inject("sidebar", () =>
      ctx.slots.register(
        { name: "sidebar" },
        function EmbeddedSidebar({ collapsed }: PropsRuntime<"sidebar">) {
          useEffect(() => {
            if (!collapsed) closeSidebar();
          }, [collapsed]);
          return null;
        }
      )
    );
    ctx.slots.inject("shell.leading", () =>
      ctx.slots.register({ name: "shell.leading", priority: -10 }, () => null)
    );
    ctx.slots.inject("conversation.hero.brand.mark", () =>
      ctx.slots.register({ name: "conversation.hero.brand.mark", priority: -10 }, () => null)
    );
    ctx.layout.toggleSidebar = () => {};
    ctx.slots.inject("conversation.header.leading", () =>
      ctx.slots.register(
        {
          name: "conversation.header.leading",
          priority: -10,
          children: { "sidebar.settings": { kind: "single", scope: "root" } },
        },
        function ProductHeader({ renderSlot }) {
          const t = copy(useStoryLocale(transport));
          return (
            <div className="story-product-header">
              {transport.bridge && (
                <Button aria-label={t.h5.back} onClick={() => void transport.bridge!.back()}>
                  <IconChevronLeft size={20} aria-hidden="true" />
                </Button>
              )}
              <strong>FizzDragon</strong>
              <span>{t.h5.title}</span>
              {renderSlot("sidebar.settings", { wide: false })}
            </div>
          );
        }
      )
    );
    // Product branding owns the visible version; keep the official presentation preferences.
    ctx.slots.inject("settings.general.item", () =>
      ctx.slots.register(
        { name: "settings.general.item", id: "developer-tools", priority: -10 },
        () => null
      )
    );
    ctx.slots.inject("settings.general.item", () =>
      ctx.slots.register(
        { name: "settings.general.item", id: "current-version", priority: -10 },
        () => null
      )
    );
    await transport.conversations.refetch();
    if (initialId) ctx.uiWorkspace.openSession(initialId);
    activate();
    ctx.on("locale/change", ({ active }) => {
      if (active !== "en" && active !== "zh") activate();
    });
    await ctx.plugin(Attachment).await();
    await ctx.plugin(InputTrigger).await();
    await ctx.plugin(Conversation).await();
    if (initialId && transport.context.initialDraft) {
      const target = sessions.scope(initialId);
      if (target)
        ctx.get("conversation")?.input.for(target).setDraft(transport.context.initialDraft);
    }
    await ctx.plugin(Commands).await();
    await ctx.plugin(Chat).await();
    await ctx
      .plugin({
        inject: ["uiConversation", "conversation", "slots"],
        apply(scope: Context) {
          for (const [kind, label] of [
            ["story-script", "scriptPanel"],
            ["story-media", "mediaPanel"],
            ["story-player", "playerPanel"],
          ] as const) {
            scope.effect(() =>
              ctx.sidebarRightTabs.register({
                id: kind,
                kind,
                title: () => copy(transport.displayLocale).h5[label],
                guide: [
                  { id: kind, order: 100, title: () => copy(transport.displayLocale).h5[label] },
                ],
              })
            );
            scope.slots.inject("sidebar.right.pane.tab", () =>
              scope.slots.register(
                { name: "sidebar.right.pane.tab", key: kind },
                function StoryPanel({ sessionId }: PropsRuntime<"sidebar.right.pane.tab">) {
                  const current = transportFor(sessionId!);
                  const t = copy(useStoryLocale(current));
                  const history = useSyncExternalStore(
                    current.history.subscribe.bind(current.history),
                    () => current.history.getCurrentResult()
                  );
                  const active = Boolean(
                    history.data?.runs.some((run) => run.chapterId === sessionId && isActive(run))
                  );
                  return (
                    <div className="story-panel">
                      {kind === "story-script" ? (
                        <ScriptOutput transport={current} title="" />
                      ) : kind === "story-media" ? (
                        <MediaOutputs transport={current} active={active} />
                      ) : (
                        <Suspense fallback={<p>{t.app.verify}</p>}>
                          <StoryPlayer transport={current} />
                        </Suspense>
                      )}
                    </div>
                  );
                }
              )
            );
          }
          function Production({ turn, sessionId }: PropsRuntime<"conversation.chat.turnTail">) {
            const transport = transportFor(sessionId);
            const locale = useStoryLocale(transport);
            const t = copy(locale);
            const snapshot = useSyncExternalStore(
              transport.history.subscribe.bind(transport.history),
              () => transport.history.getCurrentResult()
            );
            const history = transport.chapterHistory(snapshot.data);
            const event =
              history &&
              projectHistory(history).find(
                (event) => event.type === "fizz/story-run" && event.data.turn === turn.turn
              );
            const run = event?.type === "fizz/story-run" ? event.data.run : undefined;
            const [error, setError] = useState<{ code?: string; message: string }>();
            const [pending, setPending] = useState(false);
            const [clock, setClock] = useState(Date.now);
            const refreshedQuote = useRef<string | undefined>(undefined);
            useEffect(() => {
              const expiry =
                run?.status === "blocked" && run.mediaQuote
                  ? Date.parse(run.mediaQuote.expiresAt)
                  : 0;
              if (expiry <= clock) return;
              const timer = setTimeout(
                () => setClock(Date.now()),
                Math.max(0, expiry - Date.now() + 10)
              );
              return () => clearTimeout(timer);
            }, [run?.status, run?.mediaQuote, clock]);
            const act = useCallback(
              async (operation: () => Promise<void>) => {
                if (pending) return;
                setPending(true);
                setError(undefined);
                try {
                  await operation();
                } catch (reason) {
                  setError(reason instanceof Error ? reason : { message: String(reason) });
                } finally {
                  setPending(false);
                }
              },
              [pending]
            );
            useEffect(() => {
              const quote = run?.status === "blocked" ? run.mediaQuote : undefined;
              if (!quote || quote.approved || Date.parse(quote.expiresAt) > clock || pending)
                return;
              const key = `${run!.id}:${quote.batchId}:${quote.version}`;
              if (refreshedQuote.current === key) return;
              refreshedQuote.current = key;
              // Refresh is explicitly separate from consent: it cannot approve
              // or dispatch media, even when the host clock runs ahead.
              void act(() => transport.resume(run!, undefined, "refresh"));
            }, [run, clock, pending, act, transport]);
            if (!run || isActive(run)) return null;
            if (run.status === "completed" && !run.result) return null;
            const projectHistoryState = transport.history.getCurrentResult().data;
            const increase =
              run.requiredPoints !== null && run.requiredPoints > run.authorizedPoints;
            const canResume =
              !projectHistoryState?.legacyActiveRunId &&
              !projectHistoryState?.runs.some(
                (candidate) =>
                  candidate.id !== run.id && (isActive(candidate) || candidate.status === "blocked")
              );
            const latest =
              history?.runs
                .filter(
                  (candidate) =>
                    candidate.chapterId === transport.context.chapterId &&
                    candidate.phase !== "planning"
                )
                .at(-1)?.id === run.id;
            const quote =
              run.status === "blocked" && run.mediaQuote && !run.mediaQuote.approved
                ? run.mediaQuote
                : null;
            const quoteExpired = Boolean(quote && Date.parse(quote.expiresAt) <= clock);
            const authorizationLimit = projectHistoryState?.authorizationLimit;
            const exceedsLimit =
              authorizationLimit !== undefined &&
              resumeAuthorization(run, increase ? run.requiredPoints! : undefined, Boolean(quote)) >
                authorizationLimit;
            const showMedia =
              !quote &&
              latest &&
              run.result?.kind !== "script" &&
              run.chapterId === transport.context.chapterId &&
              ["asset_media", "storyboard", "clip_media", "verify"].includes(run.phase);
            const showMediaAction = showMedia && !run.result;
            const showStopAction = !quote && run.status === "blocked";
            const showResumeAction =
              !quote && ["blocked", "failed"].includes(run.status) && canResume;
            const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);
            return (
              <section className="story-production" aria-live="polite">
                {run.status === "cancelled" && <p>{t.app.stopped}</p>}
                {run.error && (
                  <>
                    <p role="alert" className="story-error">
                      {storyErrorMessage(run.error, locale)}
                    </p>
                    {storyErrorMessage(run.error, locale) !== run.error.message && (
                      <details className="story-media-error">
                        <summary>{t.h5.mediaErrorDetails}</summary>
                        <p>{run.error.message}</p>
                      </details>
                    )}
                  </>
                )}
                {error && (
                  <p role="alert" className="story-error">
                    {storyErrorMessage(error, locale)}
                  </p>
                )}
                {exceedsLimit && (
                  <p role="alert" className="story-error">
                    {t.h5.authorizationLimitExceeded.replace(
                      "{points}",
                      formatNumber(authorizationLimit!)
                    )}
                  </p>
                )}
                {quote && (
                  <article
                    className="story-media-confirmation"
                    aria-label={t.h5.mediaQuoteTitle}
                    aria-busy={pending}
                  >
                    <header className="story-quote-header">
                      <h3>{t.h5.mediaQuoteTitle}</h3>
                      <span className="story-quote-status">
                        <IconClock size={14} aria-hidden="true" />
                        {quoteExpired ? t.h5.quoteExpired : t.h5.quoteAwaitingConfirmation}
                      </span>
                    </header>
                    {quote.videoCount > 0 && (
                      <>
                        <VideoModelChoice
                          transport={transport}
                          run={run}
                          disabled={pending || !canResume}
                          onChange={(id) => void act(() => transport.changeVideoModel(run, id))}
                        />
                        <p className="story-quote-note">{t.h5.quoteModelHint}</p>
                      </>
                    )}
                    <dl className="story-quote-items">
                      {quote.imageCount > 0 && (
                        <div>
                          <dt>
                            <IconPhoto size={18} aria-hidden="true" />
                            {t.h5.quoteImages}
                          </dt>
                          <dd>{formatNumber(quote.imageCount)}</dd>
                        </div>
                      )}
                      {quote.videoCount > 0 && (
                        <div>
                          <dt>
                            <IconVideo size={18} aria-hidden="true" />
                            {t.h5.quoteVideos}
                          </dt>
                          <dd>{formatNumber(quote.videoCount)}</dd>
                        </div>
                      )}
                      {quote.routeDurationMs != null && (
                        <div>
                          <dt>
                            <IconClock size={18} aria-hidden="true" />
                            {t.h5.quoteRouteDuration}
                          </dt>
                          <dd>
                            {t.h5.quoteDurationSeconds.replace(
                              "{seconds}",
                              formatNumber(quote.routeDurationMs / 1000)
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="story-quote-cost">
                      <span>{t.h5.quoteEstimatedCost}</span>
                      <div className="story-quote-total">
                        <IconBolt size={20} aria-hidden="true" />
                        <strong>{formatNumber(quote.points)}</strong>
                        <span>{t.h5.quotePointsUnit}</span>
                      </div>
                    </div>
                    <p className="story-quote-note">
                      {quoteExpired ? t.h5.quoteExpiredHint : t.h5.quoteConsentHint}
                    </p>
                    <footer className="story-quote-actions">
                      <Button
                        className="story-quote-cancel"
                        disabled={pending || !canResume}
                        onClick={() => void act(() => transport.cancel())}
                      >
                        {t.h5.cancelGeneration}
                      </Button>
                      <Button
                        className="story-quote-confirm"
                        variant="primary"
                        disabled={
                          pending ||
                          !canResume ||
                          (!quoteExpired && (authorizationLimit === undefined || exceedsLimit))
                        }
                        onClick={() =>
                          void act(() =>
                            transport.resume(run, undefined, quoteExpired ? "refresh" : "confirm")
                          )
                        }
                      >
                        {pending
                          ? t.h5.quoteSubmitting
                          : quoteExpired
                            ? t.h5.refreshQuote
                            : t.h5.confirmGeneration}
                        {pending ? (
                          <IconLoader2
                            size={16}
                            className="story-quote-spinner"
                            aria-hidden="true"
                          />
                        ) : (
                          <IconArrowRight size={16} aria-hidden="true" />
                        )}
                      </Button>
                    </footer>
                  </article>
                )}
                {run.result &&
                  (run.result.kind === "script" ||
                    !["asset_media", "storyboard", "clip_media", "verify"].includes(run.phase)) && (
                    <ResultCard
                      run={run}
                      transport={transport}
                      latest={Boolean(latest)}
                      onOpen={(panel) => ctx.sidebarRight.openTab(panel)}
                    />
                  )}
                {(showMediaAction || showStopAction || showResumeAction) && (
                  <div className="story-result-actions" aria-busy={pending}>
                    {showResumeAction && (
                      <Button
                        className="story-result-primary"
                        variant="primary"
                        disabled={pending || authorizationLimit === undefined || exceedsLimit}
                        onClick={() =>
                          void act(() =>
                            transport.resume(run, increase ? run.requiredPoints! : undefined)
                          )
                        }
                      >
                        {pending ? (
                          <IconLoader2
                            size={18}
                            className="story-quote-spinner"
                            aria-hidden="true"
                          />
                        ) : (
                          <IconArrowRight size={18} aria-hidden="true" />
                        )}
                        {increase
                          ? t.app.authorize.replace("{points}", String(run.requiredPoints))
                          : run.status === "failed"
                            ? t.app.retryAndContinue
                            : t.app.resume}
                      </Button>
                    )}
                    {showMediaAction && (
                      <Button
                        className="story-result-secondary"
                        onClick={() => ctx.sidebarRight.openTab("story-media")}
                      >
                        <IconPhoto size={18} aria-hidden="true" />
                        {t.h5.resultViewMedia}
                      </Button>
                    )}
                    {showStopAction && (
                      <Button
                        className="story-result-secondary"
                        disabled={pending}
                        onClick={() => void act(() => transport.cancel())}
                      >
                        <IconPlayerStop size={18} aria-hidden="true" />
                        {t.app.stop}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            );
          }
          scope.slots.inject("conversation.chat.turnTail", () =>
            scope.slots.register(
              { name: "conversation.chat.turnTail", id: "story-production" },
              Production
            )
          );
          scope.uiConversation.events.register(storyMediaDefinition);
          scope.slots.inject("conversation.chat.node", () =>
            scope.slots.register(
              { name: "conversation.chat.node", key: "story-media" },
              function GenerationCards({
                node,
                sessionId,
              }: PropsRuntime<"conversation.chat.node", "story-media">) {
                const current = transportFor(sessionId);
                const history = useSyncExternalStore(
                  current.history.subscribe.bind(current.history),
                  () => current.history.getCurrentResult()
                );
                const latest =
                  history.data?.runs
                    .filter(
                      (run) =>
                        run.chapterId === current.context.chapterId && run.phase !== "planning"
                    )
                    .at(-1)?.id === node.data.id;
                return (
                  <MediaOutputs
                    transport={current}
                    active={isActive(node.data)}
                    run={node.data}
                    latest={latest}
                    onOpen={(panel) => ctx.sidebarRight.openTab(panel)}
                  />
                );
              }
            )
          );
          // Admission and spending remain Server-owned for every selected chapter.
          const block = () => {
            const t = copy(transport.displayLocale);
            const result = transport.history.getCurrentResult();
            const reason = !transport.context.ready
              ? t.h5.backendUnconfigured
              : result.error
                ? result.error.message
                : !result.data
                  ? t.h5.awaitingReceipt
                  : result.data.runs.some(
                        (run) =>
                          run.status === "blocked" && run.mediaQuote && !run.mediaQuote.approved
                      )
                    ? t.h5.quoteWaitingHint
                    : result.data.legacyActiveRunId ||
                        result.data.runs.some((run) => isActive(run) || run.status === "blocked")
                      ? t.app.previousActive
                      : undefined;
            for (const row of transport.conversations.getCurrentResult().data ?? [])
              scope.conversation.blocks.set(row.id as SessionId, reason ? { reason } : undefined);
          };
          scope.effect(() => transport.history.subscribe(block));
          scope.effect(() => transport.subscribeDisplayLocale(block));
          block();
        },
      })
      .await();
    if (transport.bridge) {
      const bridge = transport.bridge;
      ctx.effect(() => {
        const unbind = bridge.bind({
          async back() {
            if (document.fullscreenElement) {
              await document.exitFullscreen();
              return true;
            }
            const modal = [...document.querySelectorAll(modalSelector)].at(-1);
            if (modal) {
              if (modal.getAttribute("role") === "menu")
                modal.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })
                );
              else closeTopModal(document);
              return true;
            }
            const sessionId = ctx.sidebarRight.mounted.getSnapshot();
            const session = sessionId ? sessions.scope(sessionId) : undefined;
            const trigger = session ? ctx.inputTriggers.sessionOf(session) : undefined;
            if (trigger?.menu.getSnapshot().open) {
              trigger.dismiss();
              return true;
            }
            const focused = ctx.sidebarRight.focusedTarget();
            if (focused?.host === "float" && ctx.sidebarRight.canCloseTarget(focused))
              return ctx.sidebarRight.closeTarget(focused) === "closed";
            if (ctx.sidebarRight.isExpanded()) {
              ctx.sidebarRight.toggleExpanded();
              return true;
            }
            if (ctx.layout.panelInfo.getSnapshot().activePanelId) {
              ctx.layout.selectPanel(null);
              return true;
            }
            return false;
          },
          pause(paused) {
            focusManager.setFocused(!paused);
            if (paused)
              document
                .querySelectorAll<HTMLMediaElement>("video,audio")
                .forEach((media) => media.pause());
          },
          refresh() {
            void transport.queries.invalidateQueries();
          },
        });
        return () => {
          unbind();
          focusManager.setFocused(undefined);
        };
      });
      // Read persisted business state; do not mirror production in a bridge store.
      ctx.effect(() => {
        const runStates = (
          data: NonNullable<ReturnType<typeof transport.history.getCurrentResult>["data"]>
        ) =>
          new Map(
            data.runs.map((run) => [
              run.id,
              JSON.stringify([run.phase, run.status, run.result?.title]),
            ])
          );
        const chapterStates = (
          data: NonNullable<ReturnType<typeof transport.conversations.getCurrentResult>["data"]>
        ) =>
          new Map(
            data.map((chapter) => [chapter.id, JSON.stringify([chapter.title, chapter.archived])])
          );
        const initialHistory = transport.history.getCurrentResult().data;
        const initialChapters = transport.conversations.getCurrentResult().data;
        let runs = initialHistory ? runStates(initialHistory) : undefined;
        let chapters = initialChapters ? chapterStates(initialChapters) : undefined;
        const unhistory = transport.history.subscribe(({ data }) => {
          if (!data) return;
          const next = runStates(data);
          if (runs)
            for (const chapterId of new Set(
              data.runs
                .filter((run) => next.get(run.id) !== runs!.get(run.id))
                .map((run) => run.chapterId)
            ))
              bridge.contentChanged(transport.context.projectId!, chapterId);
          runs = next;
        });
        const unconversations = transport.conversations.subscribe(({ data }) => {
          if (!data) return;
          const next = chapterStates(data);
          if (chapters)
            for (const chapter of data)
              if (next.get(chapter.id) !== chapters.get(chapter.id))
                bridge.contentChanged(transport.context.projectId!, chapter.id);
          chapters = next;
        });
        return () => {
          unhistory();
          unconversations();
        };
      });
    }
    const unmount = ctx.uiRenderer.mount(container);
    container.removeAttribute("aria-busy");
    return async () => {
      unmount();

      await ctx.fiber.dispose();
    };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}
