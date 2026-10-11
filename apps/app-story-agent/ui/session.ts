import {
  createScope,
  scopeOf,
  MutableSessionEventSource,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type {
  ISessions,
  SessionBinding,
  SessionFace,
  SessionListState,
  SessionSnapshot,
  PendingSubmission,
  SessionReference,
  SessionRetainOptions,
} from "@deepseek-ai/dsh-api-session-controller/client";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type {
  IWorkspaces,
  WorkspaceSnapshot,
  WorkspaceId,
  WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller";
import { StoryTransport, copy, isActive } from "./transport";

import { projectHistory, forkBoundary } from "./events";

function createBinding(ctx: Context, transport: StoryTransport) {
  const sessionId = (transport.context.chapterId ?? "unconfigured-story") as SessionId;
  const scope = createScope(ctx, sessionId);
  const eventSource = new MutableSessionEventSource();
  const state = createSnapshotStore<SessionSnapshot>({
    sessionId,
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: "loading",
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  });
  const retention = createSnapshotStore({
    referenceCount: 0,
    retainedBy: {} as Record<string, number>,
  });
  const projections = new Map<string, ReturnType<typeof createSnapshotStore<unknown>>>();
  const projection = (key: string) => {
    let source = projections.get(key);
    if (!source) {
      source = createSnapshotStore<unknown>(undefined);
      projections.set(key, source);
    }
    return source;
  };
  const unsupported = async () => {
    throw new Error(copy(transport.context.locale).app.requestFailed);
  };
  const failure = (error: unknown) =>
    new RemoteError("gateway/internal", error instanceof Error ? error.message : String(error), {});
  const list = createSnapshotStore<SessionListState>({
    ids: [sessionId],
    byId: {},
    phase: "pending",
    projectionsBySession: {},
  });
  const echoes = new Map<
    SessionRequestId,
    {
      echo: PendingSubmission;
      retire?: (retirement: { reason: "observed"; attachments: [] } | { reason: "failed" }) => void;
    }
  >();
  const publishEchoes = () =>
    state.set({
      ...state.getSnapshot(),
      pendingSubmissions: [...echoes.values()].map((value) => value.echo),
    });
  const session: SessionFace = {
    sessionId,
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    projections: { faceOf: projection },
    beginSubmission(input) {
      const requestId = (transport.pendingSubmissionId ?? crypto.randomUUID()) as SessionRequestId;
      echoes.set(requestId, {
        echo: {
          requestId,
          placement: "transcript",
          time: Date.now(),
          text: input.text,
          attachments: input.attachments,
        },
        retire: input.onRetire,
      });
      publishEchoes();
      return {
        requestId,
        abandon() {
          echoes.get(requestId)?.retire?.({ reason: "failed" });
          echoes.delete(requestId);
          publishEchoes();
        },
      };
    },
    async prompt(content, _mode, signal, requestId) {
      try {
        signal?.throwIfAborted();
        const message = content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const attachmentIds: string[] = [];
        for (const part of content) {
          if (part.type === "file") attachmentIds.push(String(part.receiptId));
          if (part.type === "image") {
            const bytes = Uint8Array.from(atob(part.data), (char) => char.charCodeAt(0));
            const uploaded = await transport.upload(
              new Blob([bytes], { type: part.mediaType }),
              part.name ?? "reference.png",
              signal
            );
            attachmentIds.push(uploaded.id);
          }
        }
        await transport.send(
          message || copy(transport.context.locale).h5.attachmentRequest,
          requestId,
          attachmentIds
        );
        if (requestId) {
          echoes.get(requestId)?.retire?.({ reason: "observed", attachments: [] });
          echoes.delete(requestId);
          publishEchoes();
        }
        state.set({ ...state.getSnapshot(), promptError: null, promptAttempted: true });
        return { ok: true, value: { accepted: true } };
      } catch (error) {
        if (
          requestId &&
          transport.history
            .getCurrentResult()
            .data?.runs.some((run) => run.submissionId === requestId)
        ) {
          state.set({ ...state.getSnapshot(), promptError: null, promptAttempted: true });
          return { ok: true, value: { accepted: true } };
        }
        if (requestId) {
          echoes.get(requestId)?.retire?.({ reason: "failed" });
          echoes.delete(requestId);
          publishEchoes();
        }
        const result = failure(error);
        state.set({ ...state.getSnapshot(), promptError: { op: "send", error: result } });
        return { ok: false, error: result };
      }
    },
    async cancel() {
      try {
        await transport.cancel();
        return { ok: true, value: { accepted: true } };
      } catch (error) {
        const result = failure(error);
        state.set({ ...state.getSnapshot(), promptError: { op: "stop", error: result } });
        return { ok: false, error: result };
      }
    },
    async readAttachment(id) {
      try {
        const attachment = transport.history
          .getCurrentResult()
          .data?.runs.flatMap((row) => row.attachments ?? [])
          .find((row) => row.hash === id);
        if (!attachment || !attachment.width || !attachment.height)
          throw new Error("Attachment not found.");
        const response = await fetch(transport.attachmentUrl(attachment.id), {
          credentials: "same-origin",
          redirect: "error",
        });
        if (!response.ok) throw new Error("Attachment could not be read.");
        return {
          ok: true,
          value: {
            attachment: {
              attachmentId: id,
              mediaType: attachment.mediaType as "image/png",
              bytes: attachment.bytes,
              width: attachment.width,
              height: attachment.height,
              name: attachment.name,
            },
            data: new Uint8Array(await response.arrayBuffer()),
          },
        };
      } catch (error) {
        return { ok: false, error: failure(error) };
      }
    },
    updateQueue: unsupported,
    async rename(title) {
      try {
        const row = await transport.updateConversation(sessionId, { title });
        return {
          ok: true,
          value: {
            title: row.title,
            seq: 0 as import("@deepseek-ai/dsh-session/types").SessionSeq,
          },
        };
      } catch (error) {
        return { ok: false, error: failure(error) };
      }
    },
    async loadOlder() {
      state.set({ ...state.getSnapshot(), loadingOlder: true });
      try {
        await transport.loadOlder();
      } finally {
        state.set({ ...state.getSnapshot(), loadingOlder: false });
      }
    },
    async loadThrough(seq) {
      while (
        state.getSnapshot().hasMore &&
        (eventSource.getSnapshot().entries.find((entry) => entry.type === "event")?.event.seq ??
          Infinity) > seq
      ) {
        await session.loadOlder();
      }
    },
    command: unsupported,
  };
  const binding: SessionBinding = { sessionId, session, eventSource, ctx: scope.ctx };
  const retain = (options: SessionRetainOptions): SessionReference => {
    options.signal?.throwIfAborted();
    const update = (delta: number) => {
      const current = retention.getSnapshot();
      const retainedBy = {
        ...current.retainedBy,
        [options.source]: (current.retainedBy[options.source] ?? 0) + delta,
      };
      if (!retainedBy[options.source]) delete retainedBy[options.source];
      retention.set({ referenceCount: current.referenceCount + delta, retainedBy });
      const currentList = list.getSnapshot(),
        row = currentList.byId[sessionId];
      if (row)
        list.set({
          ...currentList,
          byId: { ...currentList.byId, [sessionId]: { ...row, retainedBy } },
        });
    };
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        options.signal?.removeEventListener("abort", release);
        update(-1);
      }
    };
    update(1);
    options.signal?.addEventListener("abort", release, { once: true });
    return {
      sessionId,
      get binding() {
        if (released) throw new Error("Session reference released.");
        return binding;
      },
      ready: Promise.resolve(binding),
      release,
      [Symbol.dispose]: release,
    };
  };
  const sessions: ISessions = {
    list,
    searchResultLimit: 20,
    retain(target, options) {
      if (target !== sessionId) throw new Error("Outside the selected story project.");
      return retain(options);
    },
    async using(target, options, operation) {
      if (target !== sessionId) throw new Error("Outside the selected story project.");
      const reference = retain(options);
      try {
        return await operation(reference);
      } finally {
        reference.release();
      }
    },
    retainInfo: () => retention,
    create: unsupported,
    subagentAddress: () => undefined,
    refreshProjections: async () => {},
    refresh: async () => {
      await transport.history.refetch();
    },
    search: unsupported,
    fork: unsupported,
    scope: (id) => (id === sessionId ? scope.ctx : undefined),
    scopeOf,
    sessionOf: (candidate) => (scopeOf(candidate) === sessionId ? session : undefined),
    binding: (id) => (id === sessionId ? binding : undefined),
  };

  let fingerprint = "";
  const refreshBinding = (result: ReturnType<typeof transport.history.getCurrentResult>) => {
    const all = result.data;
    const metadata = transport.queries
      .getQueryData<
        import("@repo/app-story-protocol").StoryConversation[]
      >(["story-conversations", transport.context.projectId])
      ?.find((row) => row.id === sessionId);
    const history = all && {
      ...all,
      runs: all.runs.filter((row) => row.chapterId === sessionId),
      legacyMessages: [
        ...(transport.context.chapterId === transport.legacyChapterId ? all.legacyMessages : []),
        ...(metadata?.inherited ?? []),
      ],
    };
    if (history) {
      const snapshots = history.runs.flatMap(
        (row) =>
          row.harnessEvents
            ?.filter((event) => event.type === "fizz/projections")
            .map((event) => event.data as Record<string, unknown>) ?? []
      );
      const telemetry = snapshots.at(-1);
      for (const key of ["contextPressure", "contextBreakdown"])
        projection(key).set(telemetry?.[key]);
      const buckets = [
        "uncachedInputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
      ];
      const usage = snapshots.flatMap((item) =>
        item.tokenUsage ? [item.tokenUsage as Record<string, number>] : []
      );
      projection("tokenUsage").set(
        history.usageByChapter?.[sessionId] ??
          (usage.length
            ? Object.fromEntries(
                buckets.map((key) => [
                  key,
                  usage.reduce((total, item) => total + (item[key] ?? 0), 0),
                ])
              )
            : undefined)
      );
      const recovered = history.runs.find(
        (run) => run.submissionId === transport.pendingSubmissionId
      );
      const next = JSON.stringify(history);
      if (next !== fingerprint) {
        fingerprint = next;
        eventSource.replace(
          projectHistory(history).map((event) => ({ type: "event", event })),
          Boolean(history.nextCursor)
        );
      }
      transport.acknowledge(history);
      if (recovered && state.getSnapshot().promptError?.op === "send") {
        const input = ctx.get("conversation")?.input.for(scope.ctx);
        if (input?.state.getSnapshot().draft.trim() === recovered.message.trim())
          input.setDraft("");
        state.set({ ...state.getSnapshot(), promptError: null });
      }
      for (const run of history.runs) {
        const id = run.submissionId as SessionRequestId;
        if (echoes.has(id)) {
          echoes.get(id)?.retire?.({ reason: "observed", attachments: [] });
          echoes.delete(id);
          publishEchoes();
        }
      }
    }
    const running = Boolean(history?.legacyActiveRunId || history?.runs.some(isActive));
    const blank = !history || (!history.runs.length && !history.legacyMessages.length);
    state.set({
      ...state.getSnapshot(),
      running,
      hasMore: Boolean(history?.nextCursor),
      blank,
      openState: result.isError && !history ? "error" : history ? "open" : "loading",
      openError: result.error ? failure(result.error) : null,
    });
    list.set({
      ids: [sessionId],
      phase: history ? "ready" : "pending",
      projectionsBySession: {},
      byId: {
        [sessionId]: {
          id: sessionId,
          displayTitle: metadata?.title ?? copy(transport.context.locale).h5.title,
          title: metadata?.title,
          running,
          retainedBy: retention.getSnapshot().retainedBy,
          blank,
          updatedAt: history?.runs.at(-1) ? Date.parse(history.runs.at(-1)!.updatedAt) : 0,
        },
      },
    });
  };
  const unsubscribe = transport.history.subscribe(refreshBinding);
  const unsubscribeMetadata = transport.conversations.subscribe(() =>
    refreshBinding(transport.history.getCurrentResult())
  );
  ctx.effect(() => async () => {
    unsubscribe();
    unsubscribeMetadata();
    await scope.fiber.dispose();
    transport.dispose();
  });
  return { sessions, binding, retention, list };
}

/** Chapter-backed sessions share one Query cache; official UI owns navigation, composer and retention. */
export function createStorySession(ctx: Context, root: StoryTransport) {
  const bindings = new Map<SessionId, ReturnType<typeof createBinding>>();
  const transports = new Map<SessionId, StoryTransport>();
  const list = createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    phase: "pending",
    projectionsBySession: {},
  });
  const zero = createSnapshotStore({ referenceCount: 0, retainedBy: {} });
  const get = (id: SessionId) => {
    let binding = bindings.get(id);
    if (!binding) {
      const row = root.conversations.getCurrentResult().data?.find((row) => row.id === id);
      if (!row && id !== root.context.chapterId)
        throw new Error("Outside the selected story project.");
      const transport = root.forChapter(id);
      transports.set(id, transport);
      binding = createBinding(ctx, transport);
      bindings.set(id, binding);
      binding.list.subscribe(refresh);
    }
    return binding;
  };
  const refresh = () => {
    const rows = root.conversations.getCurrentResult().data ?? [];
    const history = root.history.getCurrentResult().data;
    list.set({
      ids: rows.map((row) => row.id as SessionId),
      phase: root.conversations.getCurrentResult().data ? "ready" : "pending",
      projectionsBySession: {},
      byId: Object.fromEntries(
        rows.map((row) => {
          const runs = history?.runs.filter((run) => run.chapterId === row.id) ?? [];
          return [
            row.id,
            {
              id: row.id as SessionId,
              title: row.title,
              displayTitle: row.title,
              cwd: `story://${root.context.projectId}`,
              running: runs.some(isActive),
              blank: !runs.length && !row.inherited.length,
              retainedBy:
                bindings.get(row.id as SessionId)?.retention.getSnapshot().retainedBy ?? {},
              updatedAt: Math.max(
                Date.parse(row.updatedAt),
                ...runs.map((run) => Date.parse(run.updatedAt))
              ),
            },
          ];
        })
      ),
    });
    const current = workspace.getSnapshot();
    workspace.set({
      ...current,
      items: [view()],
      phase: list.getSnapshot().phase,
      state: root.conversations.getCurrentResult().isError ? "error" : "idle",
      archivedSessionIds: rows.filter((row) => row.archived).map((row) => row.id as SessionId),
      pinnedSessionIds: rows.filter((row) => row.pinned).map((row) => row.id as SessionId),
    });
  };
  const sessions: ISessions = {
    list,
    searchResultLimit: 20,
    retain(target, options) {
      if (typeof target !== "string") throw new Error("Subagent sessions are not available.");
      return get(target).sessions.retain(target, options);
    },
    async using(target, options, operation) {
      const ref = sessions.retain(target, options);
      try {
        return await operation(ref);
      } finally {
        ref.release();
      }
    },
    retainInfo: (id) => bindings.get(id)?.retention ?? zero,
    async create() {
      const row = await root.createConversation({
        title: copy(root.context.locale).h5.newConversation,
      });
      refresh();
      return row.id as SessionId;
    },
    subagentAddress: () => undefined,
    refreshProjections: async () => {},
    async refresh() {
      await Promise.all([root.history.refetch(), root.conversations.refetch()]);
      refresh();
    },
    async search(query, signal) {
      try {
        signal.throwIfAborted();
        await sessions.refresh();
        signal.throwIfAborted();
        const phrase = query.trim().toLocaleLowerCase();
        const matches = (root.conversations.getCurrentResult().data ?? []).flatMap((row) => {
          const messages = [
            row.title,
            ...row.inherited.map((item) => item.text),
            ...(root.history
              .getCurrentResult()
              .data?.runs.filter((run) => run.chapterId === row.id)
              .flatMap((run) => [run.message, run.assistantText ?? ""]) ?? []),
          ];
          const hit = messages.find((message) => message.toLocaleLowerCase().includes(phrase));
          if (!hit || !phrase) return [];
          const index = hit.toLocaleLowerCase().indexOf(phrase);
          return [
            {
              sessionId: row.id as SessionId,
              snippet: hit.slice(Math.max(0, index - 40), index + 180),
            },
          ];
        });
        return { ok: true, value: { items: matches.slice(0, 20), hasMore: matches.length > 20 } };
      } catch (error) {
        return {
          ok: false,
          error: new RemoteError(
            "gateway/internal",
            error instanceof Error ? error.message : String(error),
            {}
          ),
        };
      }
    },
    async fork(options) {
      const source = root.conversations
        .getCurrentResult()
        .data?.find((row) => row.id === options.sessionId);
      if (!source) throw new Error("Conversation not found.");

      const all = root.history.getCurrentResult().data;
      const selected = all && {
        ...all,
        runs: all.runs.filter((run) => run.chapterId === source.id),
        legacyMessages: [
          ...(source.id === root.legacyChapterId ? all.legacyMessages : []),
          ...source.inherited,
        ],
      };
      const atMessageId =
        options.atSeq === undefined ? undefined : selected && forkBoundary(selected, options.atSeq);
      if (options.atSeq !== undefined && !atMessageId) throw new Error("Fork boundary not found.");
      const row = await root.createConversation({
        title: options.increaseTitle ? `${source.title} (2)` : source.title,
        sourceId: source.id,
        atMessageId,
      });
      refresh();
      options.onCreated?.(row.id as SessionId);
      return row.id as SessionId;
    },
    scope: (id) => bindings.get(id)?.binding.ctx,
    scopeOf,
    sessionOf: (candidate) => {
      const id = scopeOf(candidate);
      return id ? bindings.get(id)?.binding.session : undefined;
    },
    binding: (id) => bindings.get(id)?.binding,
  };
  const view = (): WorkspaceView => ({
    workspaceId: root.context.projectId as WorkspaceId,
    path: `story://${root.context.projectId}`,
    title: copy(root.context.locale).h5.title,
    sessionIds: (root.conversations.getCurrentResult().data ?? []).map(
      (row) => row.id as SessionId
    ),
    createdAt:
      root.conversations.getCurrentResult().data?.[0]?.createdAt ?? new Date(0).toISOString(),
    updatedAt:
      root.conversations
        .getCurrentResult()
        .data?.map((row) => row.updatedAt)
        .sort()
        .at(-1) ?? new Date(0).toISOString(),
  });
  const workspace = createSnapshotStore<WorkspaceSnapshot>({
    items: [],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: "loading",
    phase: "pending",
    error: null,
  });
  const noDirectory = async () => {
    throw new Error("The host App manages the story project.");
  };
  const workspaces: IWorkspaces = {
    list: workspace,
    create: noDirectory,
    delete: noDirectory,
    rename: noDirectory,
    insertBefore: async () => {},
    initializeDefault: async () => {
      await sessions.refresh();
      return view();
    },
    archiveSession: async (id) => {
      await root.updateConversation(id, { archived: true });
    },
    unarchiveSession: async (id) => {
      await root.updateConversation(id, { archived: false });
    },
    pinSession: async (id) => {
      await root.updateConversation(id, { pinned: true });
    },
    unpinSession: async (id) => {
      await root.updateConversation(id, { pinned: false });
    },
    insertSessionBefore: async (_project, id, before) => {
      await root.updateConversation(id, { beforeId: before ?? null });
      return view();
    },
  };
  ctx.reflect.provide("sessions", sessions);
  ctx.reflect.provide("workspaces", workspaces);
  const unsubs = [root.history.subscribe(refresh), root.conversations.subscribe(refresh)];
  ctx.effect(() => () => {
    unsubs.forEach((off) => off());
    root.dispose();
  });
  return {
    sessions,
    transportFor: (id: SessionId) => transports.get(id) ?? (get(id), transports.get(id)!),
    initialId: root.context.chapterId as SessionId,
  };
}
