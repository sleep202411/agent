import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { z } from "zod/v4";
import {
  StartStoryRunSchema,
  StoryHistorySchema,
  StoryRunSchema,
  StoryOutputsSchema,
  StoryScriptSchema,
  StoryPreviewSchema,
  StoryAttachmentSchema,
  StoryConversationSchema,
  StoryConversationsSchema,
  CreateStoryConversationSchema,
  UpdateStoryConversationSchema,
  StoryVideoModelsSchema,
} from "@repo/app-story-protocol";
import type { StoryHistory, StoryRun } from "@repo/app-story-protocol";
import en from "../../web/messages/en-US.json";
import cn from "../../web/messages/zh-CN.json";
import hk from "../../web/messages/zh-HK.json";
import type { StoryBridge } from "./bridge";

export const ContextSchema = z
  .object({
    ready: z.boolean(),
    initialDraft: z.string().max(16000).optional(),
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    projectId: z.uuid().optional(),
    chapterId: z.uuid().optional(),
    standalone: z.boolean().optional(),
  })
  .refine(
    (value) =>
      !value.ready ||
      Boolean(value.projectId && value.chapterId) ||
      Boolean(value.standalone && !value.projectId && value.chapterId),
    "A ready conversation requires a project and chapter."
  );
export type StoryContext = z.infer<typeof ContextSchema>;
export const copy = (locale: StoryContext["locale"]) =>
  ({ "en-US": en, "zh-CN": cn, "zh-HK": hk })[locale].agent;
export const playerCopy = (locale: StoryContext["locale"]) =>
  ({ "en-US": en, "zh-CN": cn, "zh-HK": hk })[locale].experiencePlayer;

export const presentationLocale = (locale: string): StoryContext["locale"] =>
  ContextSchema.shape.locale.parse(locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : locale);

interface DisplayLanguage {
  getSnapshot(): { active: string };
  subscribe(listener: () => void): () => void;
}

export function storyLocale(): StoryContext["locale"] {
  const explicit = ContextSchema.shape.locale.safeParse(
    new URLSearchParams(location.search).get("locale")
  );
  if (explicit.success) return explicit.data;
  const language = navigator.language.toLowerCase();
  return language.startsWith("zh") ? (/hk|hant|tw/.test(language) ? "zh-HK" : "zh-CN") : "en-US";
}

export async function loadContext(bridge?: StoryBridge): Promise<StoryContext> {
  if (bridge) return ContextSchema.parse({ ready: true, ...(await bridge.context) });
  const query = new URLSearchParams(location.search);
  if (location.pathname === "/")
    return ContextSchema.parse(await (await fetch("/api/context")).json());
  const result = ContextSchema.safeParse({
    ready: true,
    locale: query.get("locale") ?? storyLocale(),
    projectId: query.get("projectId") ?? undefined,
    chapterId:
      query.get("chapterId") ??
      (!query.has("projectId") ? (query.get("entryId") ?? crypto.randomUUID()) : undefined),
    standalone: !query.has("projectId") && !query.has("chapterId"),
  });
  if (!result.success) throw new Error(copy(storyLocale()).h5.contextRequired);
  return result.data;
}

export function resumeAuthorization(run: StoryRun, authorizedPoints?: number, confirm = false) {
  return confirm && run.mediaQuote
    ? Math.max(run.authorizedPoints, run.committedPoints + run.mediaQuote.points)
    : (authorizedPoints ?? run.authorizedPoints);
}

export class StoryTransport {
  private displayLanguage?: DisplayLanguage;
  bindDisplayLanguage(language: DisplayLanguage) {
    if (this.owner) this.owner.bindDisplayLanguage(language);
    else this.displayLanguage = language;
  }
  get displayLocale(): StoryContext["locale"] {
    return this.owner
      ? this.owner.displayLocale
      : this.displayLanguage
        ? presentationLocale(this.displayLanguage.getSnapshot().active)
        : this.context.locale;
  }
  readonly getDisplayLocale = () => this.displayLocale;
  readonly subscribeDisplayLocale = (listener: () => void): (() => void) =>
    this.owner
      ? this.owner.subscribeDisplayLocale(listener)
      : (this.displayLanguage?.subscribe(listener) ?? (() => {}));
  readonly queries: QueryClient;
  readonly conversations: QueryObserver<ReturnType<typeof StoryConversationsSchema.parse>>;
  private readonly ownsQueries: boolean;
  legacyChapterId: string | undefined;
  readonly history: QueryObserver<StoryHistory>;
  private get path() {
    return this.local ? "/api" : `/aurora/app-story-agent/projects/${this.context.projectId}`;
  }
  private readonly local = location.pathname === "/";
  private pending: ReturnType<typeof StartStoryRunSchema.parse> | undefined;
  private get receiptKey() {
    return `story-agent:${this.context.projectId}:${this.context.chapterId}`;
  }
  private entry: Promise<void> | undefined;
  private receipt:
    | {
        submissionId: string;
        chapterId: string;
        authorizedPoints: number;
        messageHash: string;
        attachmentIds?: string[];
      }
    | undefined;
  constructor(
    readonly context: StoryContext,
    queries?: QueryClient,
    legacyChapterId = context.chapterId,
    readonly bridge?: StoryBridge,
    private readonly owner?: StoryTransport
  ) {
    this.legacyChapterId = legacyChapterId;
    this.ownsQueries = !queries;
    this.queries = queries ?? new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
    if (this.ownsQueries) this.queries.mount();
    try {
      const stored = JSON.parse(sessionStorage.getItem(this.receiptKey) ?? "null");
      const parsed = StartStoryRunSchema.omit({ message: true })
        .extend({ messageHash: z.string().regex(/^[a-f0-9]{64}$/) })
        .safeParse(stored);
      if (parsed.success && parsed.data.chapterId === context.chapterId) this.receipt = parsed.data;
    } catch {
      /* Memory retains idempotency when browser storage is unavailable. */
    }
    this.history = new QueryObserver<StoryHistory>(this.queries, {
      queryKey: ["app-story-agent", context.projectId],
      enabled: context.ready,
      queryFn: ({ signal }) => this.refreshHistory(signal),
      refetchInterval: (query) => (query.state.data?.runs.some(isActive) ? 1000 : 10000),
      refetchIntervalInBackground: false,
    });
    this.conversations = new QueryObserver<ReturnType<typeof StoryConversationsSchema.parse>>(
      this.queries,
      {
        queryKey: ["story-conversations", context.projectId],
        enabled: context.ready,
        queryFn: ({ signal }) =>
          context.standalone && !context.projectId
            ? Promise.resolve([
                {
                  id: context.chapterId!,
                  title: copy(this.displayLocale).h5.newConversation,
                  pinned: false,
                  archived: false,
                  rank: 0,
                  inherited: [],
                  createdAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                },
              ])
            : this.request("/conversations", StoryConversationsSchema, undefined, signal),
        refetchInterval: 10000,
      }
    );
  }
  async initializeProject() {
    if (this.owner && this.context.standalone) {
      await this.owner.initializeProject();
      this.bindProject();
      return;
    }
    if (!this.context.standalone) return;
    if (!this.entry)
      this.entry = this.createEntry().catch((error) => {
        this.entry = undefined;
        throw error;
      });
    return this.entry;
  }
  private async createEntry() {
    if (!this.context.projectId) {
      const url = new URL(location.href);
      const entryId = this.context.chapterId!;
      if (!z.uuid().safeParse(entryId).success)
        throw new Error(copy(this.displayLocale).h5.contextRequired);
      url.searchParams.set("entryId", entryId);
      window.history.replaceState(null, "", url);
      const response = await fetch("/aurora/app-story-agent/entry", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "content-type": "application/json", "accept-language": this.context.locale },
        body: JSON.stringify({
          entryId,
          locale: this.context.locale,
          title: copy(this.displayLocale).h5.newConversation,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.code !== 200)
        throw new Error(
          payload?.msg || payload?.message || copy(this.displayLocale).app.requestFailed
        );
      const context = ContextSchema.safeParse(payload.data);
      if (
        !context.success ||
        !context.data.ready ||
        context.data.projectId !== entryId ||
        context.data.chapterId !== entryId
      )
        throw new Error(copy(this.displayLocale).h5.backendInvalidResponse);
      Object.assign(this.context, context.data);
      this.legacyChapterId = this.context.chapterId;
      url.searchParams.delete("entryId");
      url.searchParams.set("projectId", this.context.projectId!);
      url.searchParams.set("chapterId", this.context.chapterId!);
      url.searchParams.set("locale", this.context.locale);
      window.history.replaceState(null, "", url);
      this.bindProject();
    }
    const results = await Promise.all([this.history.refetch(), this.conversations.refetch()]);
    for (const result of results) if (result.error) throw result.error;
    this.context.standalone = false;
  }
  private bindProject() {
    this.history.setOptions({ ...this.history.options, queryKey: this.historyKey() });
    this.conversations.setOptions({
      ...this.conversations.options,
      queryKey: ["story-conversations", this.context.projectId],
    });
  }
  chapterHistory(history = this.history.getCurrentResult().data): StoryHistory | undefined {
    const metadata = this.queries
      .getQueryData<
        ReturnType<typeof StoryConversationsSchema.parse>
      >(["story-conversations", this.context.projectId])
      ?.find((row) => row.id === this.context.chapterId);
    return (
      history && {
        ...history,
        runs: history.runs.filter((row) => row.chapterId === this.context.chapterId),
        legacyMessages: [
          ...(this.context.chapterId === this.legacyChapterId ? history.legacyMessages : []),
          ...(metadata?.inherited ?? []),
        ],
      }
    );
  }
  private historyKey() {
    return ["app-story-agent", this.context.projectId];
  }
  private mergeRuns(older: StoryRun[], newer: StoryRun[]) {
    const rows = new Map(older.map((row) => [row.id, row]));
    for (const row of newer) {
      const existing = rows.get(row.id);
      if (!existing || row.version >= existing.version) rows.set(row.id, row);
    }
    return [...rows.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
  }
  private async refreshHistory(signal: AbortSignal): Promise<StoryHistory> {
    if (this.context.standalone && !this.context.projectId)
      return { runs: [], legacyMessages: [], legacyActiveRunId: null, authorizationLimit: 0 };
    const previous = this.queries.getQueryData<StoryHistory>(this.historyKey());
    let page = await this.request("/history", StoryHistorySchema, undefined, signal);
    let runs = page.runs;
    while (
      previous?.runs.length &&
      page.nextCursor &&
      !runs.some((row) => previous.runs.some((old) => old.id === row.id))
    ) {
      page = await this.request(
        `/history?cursor=${page.nextCursor}`,
        StoryHistorySchema,
        undefined,
        signal
      );
      runs = this.mergeRuns(page.runs, runs);
    }
    return {
      ...page,
      runs: this.mergeRuns(previous?.runs ?? [], runs),
      nextCursor: previous?.runs.length ? previous.nextCursor : page.nextCursor,
    };
  }
  async loadOlder(signal?: AbortSignal) {
    const previous = this.queries.getQueryData<StoryHistory>(this.historyKey());
    if (!previous?.nextCursor) return;
    const cursor = previous.nextCursor;
    const older = await this.request(
      `/history?cursor=${cursor}`,
      StoryHistorySchema,
      undefined,
      signal
    );
    this.queries.setQueryData<StoryHistory>(this.historyKey(), (current) =>
      current
        ? {
            ...current,
            runs: this.mergeRuns(older.runs, current.runs),
            nextCursor: current.nextCursor === cursor ? older.nextCursor : current.nextCursor,
          }
        : older
    );
  }
  async request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    body?: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    if (this.bridge?.authenticationRequired)
      throw Object.assign(new Error(copy(this.displayLocale).h5.sessionRequired), { status: 401 });
    const response = await fetch(`${this.path}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "accept-language": this.context.locale },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      redirect: "error",
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401 || payload?.code === 401) this.bridge?.authenticationExpired();
    if (!payload || typeof payload !== "object")
      throw new Error(copy(this.displayLocale).h5.backendInvalidResponse);
    const businessFailure = this.local
      ? payload.code !== undefined && payload.code !== 200
      : payload.code !== 200;
    if (!response.ok || businessFailure) {
      const error = new Error(
        payload.msg || payload.message || copy(this.displayLocale).app.requestFailed
      );
      Object.assign(error, { status: response.ok ? payload.code : response.status });
      throw error;
    }
    try {
      return schema.parse(this.local ? payload : payload.data);
    } catch {
      throw new Error(copy(this.displayLocale).h5.backendInvalidResponse);
    }
  }
  get pendingSubmissionId() {
    return this.receipt?.submissionId;
  }
  acknowledge(history: StoryHistory) {
    if (this.receipt && history.runs.some((run) => run.submissionId === this.receipt!.submissionId))
      this.savePending(undefined);
  }
  async send(message: string, submissionId?: string, attachmentIds?: string[]) {
    await this.initializeProject();
    if (!this.context.ready || !this.context.chapterId)
      throw new Error(copy(this.displayLocale).h5.backendUnconfigured);
    const refreshed = await this.history.refetch();
    if (refreshed.error) throw refreshed.error;
    const history = refreshed.data;
    if (!history) throw new Error(copy(this.displayLocale).h5.backendUnavailable);
    // Retain the same submission after an uncertain reply. Server owns admission
    // and spending; a lost HTTP response must never create a second paid run.
    const observed =
      this.receipt && history.runs.find((run) => run.submissionId === this.receipt!.submissionId);
    if (observed) {
      this.savePending(undefined);
      if (
        observed.message.trim() === message.trim() &&
        JSON.stringify(observed.attachments?.map((row) => row.id) ?? []) ===
          JSON.stringify(attachmentIds ?? [])
      )
        return observed;
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({ message: message.trim(), attachments: attachmentIds ?? [] })
      )
    );
    const messageHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (this.receipt && this.receipt.messageHash !== messageHash)
      throw new Error(copy(this.displayLocale).h5.awaitingReceipt);
    if (
      history.legacyActiveRunId ||
      history.runs.some((run) => isActive(run) || run.status === "blocked")
    )
      throw new Error(copy(this.displayLocale).app.previousActive);
    this.savePending(
      StartStoryRunSchema.parse({
        submissionId: this.receipt?.submissionId ?? submissionId ?? crypto.randomUUID(),
        chapterId: this.context.chapterId,
        message,
        authorizedPoints: this.receipt?.authorizedPoints ?? 0,
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      }),
      messageHash
    );
    let accepted: StoryRun;
    try {
      accepted = await this.request("/runs", StoryRunSchema, this.pending);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429)
        this.savePending(undefined);
      throw error;
    }
    this.savePending(undefined);
    await this.history.refetch();
    return accepted;
  }
  private savePending(value: typeof this.pending, messageHash?: string) {
    this.pending = value;
    this.receipt =
      value && messageHash
        ? {
            submissionId: value.submissionId,
            chapterId: value.chapterId,
            authorizedPoints: value.authorizedPoints,
            attachmentIds: value.attachmentIds,
            messageHash,
          }
        : undefined;
    try {
      if (this.receipt) sessionStorage.setItem(this.receiptKey, JSON.stringify(this.receipt));
      else sessionStorage.removeItem(this.receiptKey);
    } catch {
      /* An in-page retry still reuses the same receipt. */
    }
  }
  async cancel() {
    const active = this.history
      .getCurrentResult()
      .data?.runs.find(
        (run) =>
          run.chapterId === this.context.chapterId && (isActive(run) || run.status === "blocked")
      );
    if (!active) throw new Error(copy(this.displayLocale).app.previousActive);
    await this.request(`/runs/${active.id}/cancel`, StoryRunSchema, {});
    await this.history.refetch();
  }
  async resume(run: StoryRun, authorizedPoints?: number, mediaAction?: "confirm" | "refresh") {
    const quote = mediaAction ? run.mediaQuote : undefined;
    if (mediaAction && !quote) throw new Error(copy(this.displayLocale).h5.quoteUnavailable);
    if (mediaAction !== "refresh") {
      const current = await this.history.refetch({ throwOnError: true });
      if (!current.data) throw new Error(copy(this.displayLocale).app.previousActive);
      if (
        resumeAuthorization(run, authorizedPoints, mediaAction === "confirm") >
        current.data.authorizationLimit
      )
        throw new Error(
          copy(this.displayLocale).h5.authorizationLimitExceeded.replace(
            "{points}",
            new Intl.NumberFormat(this.displayLocale).format(current.data.authorizationLimit)
          )
        );
    }
    await this.request(`/runs/${run.id}/resume`, StoryRunSchema, {
      authorizedPoints,
      ...(mediaAction === "refresh" ? { refreshQuote: true } : {}),
      ...(quote
        ? {
            confirmedQuote: {
              batchId: quote.batchId,
              version: quote.version,
              points: quote.points,
            },
          }
        : {}),
    });
    await this.history.refetch();
  }
  videoModels(runId: string, signal?: AbortSignal) {
    return this.request(`/runs/${runId}/video-models`, StoryVideoModelsSchema, undefined, signal);
  }
  async changeVideoModel(run: StoryRun, modelId: string) {
    const quote = run.mediaQuote;
    if (!quote) throw new Error(copy(this.displayLocale).h5.quoteUnavailable);
    await this.request(`/runs/${run.id}/video-model`, StoryRunSchema, {
      modelId,
      runVersion: run.version,
      quote: { batchId: quote.batchId, version: quote.version, points: quote.points },
    });
    await this.history.refetch();
  }
  outputs(signal?: AbortSignal, runId?: string) {
    return this.request(
      `/chapters/${this.context.chapterId}/outputs${runId ? `?runId=${runId}` : ""}`,
      StoryOutputsSchema,
      undefined,
      signal
    );
  }
  script(signal?: AbortSignal) {
    return this.request(
      `/chapters/${this.context.chapterId}/script`,
      StoryScriptSchema,
      undefined,
      signal
    );
  }
  preview(signal?: AbortSignal) {
    return this.request(
      `/chapters/${this.context.chapterId}/preview`,
      StoryPreviewSchema,
      undefined,
      signal
    );
  }
  forChapter(chapterId: string) {
    return new StoryTransport(
      this.context.standalone ? this.context : { ...this.context, chapterId },
      this.queries,
      this.legacyChapterId,
      this.bridge,
      this
    );
  }
  async createConversation(input: ReturnType<typeof CreateStoryConversationSchema.parse>) {
    const row = await this.request(
      "/conversations",
      StoryConversationSchema,
      CreateStoryConversationSchema.parse(input)
    );
    await this.conversations.refetch();
    return row;
  }
  async updateConversation(
    chapterId: string,
    input: ReturnType<typeof UpdateStoryConversationSchema.parse>
  ) {
    const row = await this.request(
      `/chapters/${chapterId}/conversation`,
      StoryConversationSchema,
      UpdateStoryConversationSchema.parse(input)
    );
    await this.conversations.refetch();
    return row;
  }
  attachmentUrl(id: string) {
    return `${this.path}/chapters/${this.context.chapterId}/attachments/${id}`;
  }
  async attachmentData(id: string) {
    if (this.bridge?.authenticationRequired)
      throw new Error(copy(this.displayLocale).h5.sessionRequired);
    const response = await fetch(this.attachmentUrl(id), {
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401) this.bridge?.authenticationExpired();
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.msg || error?.message || copy(this.displayLocale).app.requestFailed);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  async upload(
    file: Blob,
    name: string,
    signal?: AbortSignal,
    onProgress?: (progress: { loaded: number; total?: number }) => void
  ) {
    if (this.bridge?.authenticationRequired)
      throw new Error(copy(this.displayLocale).h5.sessionRequired);
    if (file.size > 10 * 1024 * 1024)
      throw new Error(copy(this.displayLocale).h5.attachmentTooLarge);
    signal?.throwIfAborted();
    await this.initializeProject();
    const form = new FormData();
    form.append("file", file, name);
    const payload = await new Promise<unknown>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => {
        xhr.abort();
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      xhr.open("POST", `${this.path}/chapters/${this.context.chapterId}/attachments`);
      xhr.timeout = 60000;
      xhr.responseType = "json";
      xhr.withCredentials = true;
      xhr.setRequestHeader("accept-language", this.context.locale);
      xhr.upload.onprogress = (event) =>
        onProgress?.({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : undefined,
        });
      xhr.onerror = xhr.ontimeout = () => {
        cleanup();
        reject(new Error(copy(this.displayLocale).h5.backendUnavailable));
      };
      xhr.onload = () => {
        cleanup();
        const value = xhr.response;
        if (xhr.status === 401 || value?.code === 401) this.bridge?.authenticationExpired();
        if (
          xhr.status < 200 ||
          xhr.status >= 300 ||
          (value?.code !== undefined && value.code !== 200) ||
          (!this.local && value?.code !== 200)
        )
          return reject(
            new Error(value?.msg || value?.message || copy(this.displayLocale).app.requestFailed)
          );
        resolve(this.local ? value : value?.data);
      };
      xhr.send(form);
    });
    return StoryAttachmentSchema.parse(payload);
  }
  dispose() {
    this.history.destroy();
    this.conversations.destroy();
    if (this.ownsQueries) {
      this.queries.unmount();
      this.queries.clear();
    }
  }
}
export const isActive = (run: StoryRun) =>
  ["queued", "planning", "producing", "cancelling"].includes(run.status);
