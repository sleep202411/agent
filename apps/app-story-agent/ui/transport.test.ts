// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryHistory, StoryRun } from "@repo/app-story-protocol";
import { StoryTransport, copy, loadContext } from "./transport";
import { projectHistory, forkBoundary, storyMediaDefinition, videoProgress } from "./events";

const projectId = "00000000-0000-4000-8000-000000000001";
const chapterId = "00000000-0000-4000-8000-000000000002";
const history: StoryHistory = {
  runs: [],
  legacyMessages: [],
  legacyActiveRunId: null,
  authorizationLimit: 10,
};
const run = (input: Record<string, unknown>): StoryRun => ({
  version: 1,
  id: "00000000-0000-4000-8000-000000000003",
  chapterId,
  submissionId: String(input.submissionId),
  message: String(input.message),
  status: "planning",
  phase: "planning",
  assistantText: null,
  authorizedPoints: 10,
  committedPoints: 0,
  requiredPoints: null,
  error: null,
  result: null,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:01Z",
});
const transports: StoryTransport[] = [];
const create = () => {
  const transport = new StoryTransport({
    ready: true,
    locale: "en-US",
    projectId,
    chapterId,
  });
  transports.push(transport);
  return transport;
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  transports.splice(0).forEach((transport) => transport.dispose());
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Standalone browser entry", () => {
  const page = "/aurora/app-story-agent/ui/index.html";
  it("opens a bare link without creating a project or changing the native context contract", async () => {
    window.history.replaceState(null, "", page);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const context = await loadContext();
    expect(context).toMatchObject({ ready: true, locale: "en-US", standalone: true });
    const transport = new StoryTransport(context);
    transports.push(transport);
    expect((await transport.history.refetch()).data?.runs).toEqual([]);
    expect((await transport.conversations.refetch()).data?.[0]?.id).toBe(context.chapterId);
    expect(fetch).not.toHaveBeenCalled();
    window.history.replaceState(null, "", `${page}?projectId=${projectId}&chapterId=${chapterId}`);
    expect(await loadContext()).toMatchObject({
      ready: true,
      projectId,
      chapterId,
      standalone: false,
    });
  });
  it("rejects incomplete or invalid explicit context instead of creating a different project", async () => {
    for (const query of [`projectId=${projectId}`, "chapterId=broken", "locale=unsupported"]) {
      window.history.replaceState(null, "", `${page}?${query}`);
      await expect(loadContext()).rejects.toThrow(copy("en-US").h5.contextRequired);
    }
  });
  it("creates once on first use, restores from the URL and retains the entry ID after an uncertain reply", async () => {
    window.history.replaceState(null, "", page);
    const entries: string[] = [];
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith("/entry")) {
          const input = JSON.parse(String(options?.body));
          entries.push(input.entryId);
          if (fail) {
            fail = false;
            throw new TypeError("Network unavailable");
          }
          return response({
            code: 200,
            data: {
              ready: true,
              locale: "en-US",
              projectId: input.entryId,
              chapterId: input.entryId,
            },
          });
        }
        if (url.endsWith("/history")) return response({ code: 200, data: history });
        if (url.endsWith("/conversations")) return response({ code: 200, data: [] });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const transport = new StoryTransport(await loadContext());
    transports.push(transport);
    const child = transport.forChapter(transport.context.chapterId!);
    transports.push(child);
    await expect(child.initializeProject()).rejects.toThrow("Network unavailable");
    await Promise.all([transport.initializeProject(), child.initializeProject()]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe(entries[1]);
    expect(transport.context).toMatchObject({
      projectId: entries[0],
      chapterId: entries[0],
      standalone: false,
    });
    expect(location.search).not.toContain("entryId");
    expect((await loadContext()).projectId).toBe(entries[0]);
    await transport.initializeProject();
    expect(entries).toHaveLength(2);
  });
});

describe("Story UI admission and recovery", () => {
  it("blocks cumulative spending above the regional cap but permits exact-cap confirmation and free quote refresh", async () => {
    const posted: unknown[] = [];
    const paused: StoryRun = {
      ...run({ submissionId: projectId, message: "Make a film" }),
      status: "blocked",
      committedPoints: 80,
      authorizedPoints: 80,
      mediaQuote: {
        batchId: projectId,
        version: 1,
        points: 21,
        imageCount: 1,
        videoCount: 0,
        approved: false,
        expiresAt: "2099-01-01T00:00:00Z",
      },
    };
    let limit = 100;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/history"))
          return response({ ...history, authorizationLimit: limit, runs: [paused] });
        posted.push(JSON.parse(String(options.body)));
        return response(paused);
      })
    );
    const transport = create();
    await expect(transport.resume(paused, undefined, "confirm")).rejects.toThrow(
      "100 compute points"
    );
    expect(posted).toEqual([]);
    await expect(transport.resume(paused, 101)).rejects.toThrow("100 compute points");
    expect(posted).toEqual([]);
    const exact = { ...paused, mediaQuote: { ...paused.mediaQuote!, points: 20 } };
    await transport.resume(exact, undefined, "confirm");
    expect(posted).toEqual([{ confirmedQuote: { batchId: projectId, version: 1, points: 20 } }]);
    // A stale client cap must not override a newly lowered regional limit.
    limit = 90;
    await expect(transport.resume(exact, undefined, "confirm")).rejects.toThrow(
      "90 compute points"
    );
    await transport.resume(paused, undefined, "refresh");
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ refreshQuote: true });
  });

  it("keeps media outside collapsed process groups with the same node identity through completion", () => {
    const producing = {
      ...run({ submissionId: chapterId, message: "Make a story" }),
      status: "producing" as const,
      phase: "asset_media",
    };
    const event = projectHistory({ ...history, runs: [producing] }).find(
      (row) => row.type === "fizz/story-run"
    )!;
    expect(storyMediaDefinition.match(event)).toEqual({ id: producing.id, role: "start" });
    const context = {
      key: producing.id,
      id: producing.id,
      kind: "story-media",
      matches: [],
      current: new Map(),
      state: producing,
      start: { event, role: "start" as const, location: { kind: "session" as const } },
    };
    const active = storyMediaDefinition.buildViewNode!(context);
    const completed = storyMediaDefinition.buildViewNode!({
      ...context,
      state: { ...producing, status: "completed" },
    });
    expect(active).toMatchObject({
      key: producing.id,
      visibility: "visible",
      location: { kind: "session" },
    });
    expect(completed?.key).toBe(active?.key);
    expect(
      storyMediaDefinition.match({
        ...event,
        data: { turn: 1, run: { ...producing, phase: "planning" } },
      } as typeof event)
    ).toBeNull();
  });
  it("loads generation cards for the exact run and requires a real URL before ready", async () => {
    const id = "00000000-0000-4000-8000-000000000004";
    let ready = false;
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/chapters/${chapterId}/outputs?runId=${id}`);
      return response([
        {
          id,
          kind: "video",
          title: "Home",
          status: ready ? "ready" : "generating",
          url: null,
          posterUrl: "https://media.example/reference.png",
          durationMs: 5000,
          error: null,
        },
      ]);
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await create().outputs(undefined, id)).toMatchObject([
      { id, status: "generating", url: null },
    ]);
    ready = true;
    await expect(create().outputs(undefined, id)).rejects.toThrow();
  });
  it("counts only ready video seconds, retains all branches and never guesses missing timing", () => {
    const video = {
      id: chapterId,
      kind: "video" as const,
      title: "Scene",
      status: "ready" as const,
      url: "https://media.example/scene.mp4",
      posterUrl: null,
      durationMs: 5000,
      error: null,
    };
    const generating = {
      ...video,
      id: projectId,
      status: "generating" as const,
      durationMs: 8000,
      url: null,
    };
    const queued = { ...video, status: "queued" as const, durationMs: 10000, url: null };
    expect(
      videoProgress([video, generating, queued, { ...video, kind: "image", durationMs: null }])
    ).toMatchObject({
      completedCount: 1,
      completedMs: 5000,
      totalMs: 23000,
      current: generating,
    });
    expect(
      videoProgress([video, { ...generating, status: "failed", error: "Provider failure" }])
    ).toMatchObject({ completedMs: 5000, totalMs: 13000, current: { status: "failed" } });
    expect(videoProgress([video, { ...queued, status: "cancelled" }])).toMatchObject({
      completedMs: 5000,
      totalMs: 15000,
    });
    expect(videoProgress([video, { ...generating, durationMs: null }])).toMatchObject({
      completedCount: 1,
      completedMs: null,
      totalMs: null,
    });
  });
  it("recovers a lost accepted reply after reload without admitting or swallowing a different message", async () => {
    const submissions: Record<string, unknown>[] = [];
    let durable: StoryRun | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/history"))
          return response({ ...history, runs: durable ? [durable] : [] });
        const input = JSON.parse(String(options.body));
        submissions.push(input);
        durable = run(input);
        throw new TypeError("Network reply lost");
      })
    );
    await expect(create().send("Hello")).rejects.toThrow("Network reply lost");
    expect(sessionStorage.getItem(`story-agent:${projectId}:${chapterId}`)).not.toContain("Hello");
    const resumed = create();
    await expect(resumed.send("Hello")).resolves.toMatchObject({
      submissionId: submissions[0]!.submissionId,
    });
    expect(submissions).toHaveLength(1);
    await expect(resumed.send("A different request")).rejects.toThrow("previous production");
    expect(submissions).toHaveLength(1);
  });

  it("reuses the receipt when the first request never arrived, and does not send a changed draft", async () => {
    const submissions: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/history")) return response(history);
        const input = JSON.parse(String(options.body));
        submissions.push(input);
        if (submissions.length === 1) throw new TypeError("Offline");
        return response(run(input));
      })
    );
    await expect(create().send("Hello")).rejects.toThrow("Offline");
    const resumed = create();
    await expect(resumed.send("Different")).rejects.toThrow("Confirming");
    await resumed.send("Hello");
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0].authorizedPoints).toBe(0);
  });

  it("rejects stale history and upstream business failures while allowing a corrected request", async () => {
    let unavailable = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/history"))
          return unavailable ? response({ message: "Not logged in!" }, 401) : response(history);
        return response({ code: 400, msg: "Authorization too high" });
      })
    );
    const transport = create();
    await expect(transport.send("Hello")).rejects.toThrow("Not logged in!");
    unavailable = false;
    await expect(transport.send("Hello")).rejects.toThrow("Authorization too high");
    expect(sessionStorage.length).toBe(0);
    await expect(transport.send("Corrected request")).rejects.toThrow("Authorization too high");
    vi.stubGlobal("location", { pathname: "/index.html" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ data: history }))
    );
    await expect(create().send("Hello")).rejects.toThrow(copy("en-US").app.requestFailed);
  });

  it("preserves attachment receipts after a lost request and never swallows a changed attachment", async () => {
    const fileId = projectId,
      otherId = chapterId,
      submissions: Record<string, unknown>[] = [];
    let durable: StoryRun | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/history"))
          return response({ ...history, runs: durable ? [durable] : [] });
        const input = JSON.parse(String(options.body));
        submissions.push(input);
        if (submissions.length === 1) throw new Error("Offline");
        durable = {
          ...run(input),
          attachments: [
            {
              id: fileId,
              name: "reference.txt",
              hash: "a".repeat(64),
              mediaType: "text/plain",
              bytes: 10,
              width: null,
              height: null,
            },
          ],
        };
        return response(durable);
      })
    );
    await expect(create().send("Use this", undefined, [fileId])).rejects.toThrow("Offline");
    expect(
      JSON.parse(sessionStorage.getItem(`story-agent:${projectId}:${chapterId}`)!)
    ).toMatchObject({ attachmentIds: [fileId] });
    const resumed = create();
    await resumed.send("Use this", undefined, [fileId]);
    expect(submissions[1]).toEqual(submissions[0]);
    await expect(resumed.send("Use this", undefined, [otherId])).rejects.toThrow(
      "previous production"
    );
  });

  it("confirms only the displayed media quote, keeping ordinary resume distinct", async () => {
    const posted: unknown[] = [];
    const paused = {
      ...run({ submissionId: projectId, message: "Make a film" }),
      status: "blocked" as const,
      mediaQuote: {
        batchId: projectId,
        version: 4,
        points: 32,
        imageCount: 4,
        videoCount: 0,
        expiresAt: "2099-01-01T00:00:00Z",
        approved: false,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/history"))
          return response({ ...history, authorizationLimit: 100, runs: [paused] });
        posted.push(JSON.parse(String(options.body)));
        return response(paused);
      })
    );
    const transport = create();
    await transport.resume(paused, undefined, "confirm");
    expect(posted[0]).toEqual({ confirmedQuote: { batchId: projectId, version: 4, points: 32 } });
    await transport.resume({ ...paused, mediaQuote: null });
    expect(posted[1]).toEqual({});
    await transport.resume(paused, undefined, "refresh");
    expect(posted[2]).toEqual({
      refreshQuote: true,
      confirmedQuote: { batchId: projectId, version: 4, points: 32 },
    });
  });

  it("requotes a model change without confirmation and confirms only the returned price", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    let paused: StoryRun = {
      ...run({ submissionId: projectId, message: "Make a film" }),
      status: "blocked",
      mediaQuote: {
        batchId: projectId,
        version: 1,
        points: 32,
        imageCount: 1,
        videoCount: 2,
        expiresAt: "2099-01-01T00:00:00Z",
        approved: false,
        videoModelId: "seedance-2-0",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith("/history"))
          return response({ ...history, authorizationLimit: 100, runs: [paused] });
        if (url.endsWith("/video-models"))
          return response({
            selectedModelId: "seedance-2-0",
            models: [{ id: "minimax-h3-max", name: "MiniMax H3 Max" }],
          });
        posted.push({ url, body: JSON.parse(String(options.body)) });
        if (url.endsWith("/video-model"))
          paused = {
            ...paused,
            version: 2,
            mediaQuote: {
              ...paused.mediaQuote!,
              batchId: chapterId,
              points: 60,
              videoModelId: "minimax-h3-max",
            },
          };
        return response(paused);
      })
    );
    const transport = create();
    await transport.videoModels(paused.id);
    await transport.changeVideoModel(paused, "minimax-h3-max");
    expect(posted[0]!.body).toEqual({
      modelId: "minimax-h3-max",
      runVersion: 1,
      quote: { batchId: projectId, version: 1, points: 32 },
    });
    const latest = transport.history.getCurrentResult().data!.runs[0]!;
    expect(latest.mediaQuote).toMatchObject({ points: 60, approved: false });
    await transport.resume(latest, undefined, "confirm");
    expect(posted[1]!.body).toEqual({
      confirmedQuote: { batchId: chapterId, version: 1, points: 60 },
    });
  });

  it("places the validated reply after its final tool result without duplicating model usage", () => {
    const final = {
      ...run({ submissionId: projectId, message: "Hi" }),
      status: "completed" as const,
      assistantText: "Hello",
      harnessEvents: [
        { type: "step/start", data: { turn: 1, step: 1 } },
        {
          type: "assistant/message",
          data: {
            turn: 1,
            step: 1,
            usage: { outputTokens: 7 },
            stream: [],
            message: { id: "reply", role: "assistant", content: [{ type: "text", text: "Hello" }] },
          },
        },
        { type: "tool/call", data: { turn: 1, step: 1 } },
        { type: "tool/result", data: { turn: 1, step: 1 } },
        { type: "step/end", data: { turn: 1, step: 1 } },
      ],
    };
    const events = projectHistory({ ...history, runs: [final] });
    const reply = events.filter((event) => event.type === "assistant/message");
    expect(reply).toHaveLength(1);
    expect(reply[0].seq).toBeGreaterThan(events.find((event) => event.type === "tool/result")!.seq);
    expect(reply[0].data).toMatchObject({ usage: { outputTokens: 7 } });
    expect(forkBoundary({ ...history, runs: [final] }, events.at(-1)!.seq)).toBe(
      final.id + ":assistant"
    );
  });

  it("keeps forked history in message order and preserves the exact assistant boundary", () => {
    const inherited = {
      ...history,
      legacyMessages: [
        {
          id: "source:user",
          role: "user" as const,
          text: "Question",
          createdAt: "2026-10-10T00:00:00Z",
        },
        {
          id: "source:assistant",
          role: "assistant" as const,
          text: "Answer",
          createdAt: "2026-10-10T00:03:00Z",
        },
        { id: "next:user", role: "user" as const, text: "Next", createdAt: "2026-10-10T00:01:00Z" },
      ],
    };
    const events = projectHistory(inherited);
    expect(events.filter((event) => event.type === "turn/start")).toHaveLength(2);
    const reply = events.find((event) => event.type === "assistant/message")!;
    expect(forkBoundary(inherited, reply.seq)).toBe("source:assistant");
    expect(events.find((event) => event.type === "user/message")!.seq).toBeLessThan(reply.seq);
  });

  it("keeps stable event positions while loading older history and forks the selected message prefix", async () => {
    const old = {
      ...run({ submissionId: projectId, message: "Old" }),
      id: projectId,
      status: "completed" as const,
      assistantText: "Old answer",
      historyIndex: 0,
    };
    const latest = {
      ...run({ submissionId: chapterId, message: "New" }),
      status: "completed" as const,
      assistantText: "New answer",
      historyIndex: 1,
      createdAt: "2026-10-10T00:01:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(
          url.includes("?cursor=")
            ? { ...history, runs: [old], nextCursor: null }
            : { ...history, runs: [latest], nextCursor: latest.id }
        )
      )
    );
    const transport = create();
    await transport.history.refetch();
    const before = projectHistory(transport.history.getCurrentResult().data!)
      .filter((event) => event.type === "user/message")
      .map((event) => event.seq);
    await transport.loadOlder();
    const current = transport.queries.getQueryData<StoryHistory>(["app-story-agent", projectId])!;
    expect(current.runs.map((row) => row.id)).toEqual([old.id, latest.id]);
    expect(current.nextCursor).toBeNull();
    expect(
      projectHistory(current)
        .filter((event) => event.type === "user/message")
        .map((event) => event.seq)
    ).toContain(before[0]);
    expect(forkBoundary(current, 800)).toBe(`${old.id}:assistant`);
    expect(forkBoundary(current, 1003)).toBe(`${latest.id}:user`);
    await transport.history.refetch();
    expect(
      transport.queries.getQueryData<StoryHistory>(["app-story-agent", projectId])?.runs
    ).toHaveLength(2);
    expect(
      transport.queries.getQueryData<StoryHistory>(["app-story-agent", projectId])?.nextCursor
    ).toBeNull();
  });

  it("closes failed/cancelled turns and keeps open production open without displaying raw tools", () => {
    const events = projectHistory({
      ...history,
      legacyMessages: [
        { id: "tool", role: "assistant", text: "story_read", createdAt: "2026-10-10T00:00:00Z" },
      ],
      runs: [
        {
          ...run({ submissionId: projectId, message: "Create" }),
          status: "failed",
          error: { code: "FAILED", message: "Provider refused" },
        },
        { ...run({ submissionId: chapterId, message: "Continue" }), id: projectId },
      ],
    });
    expect(events.filter((event) => event.type === "user/message")).toHaveLength(2);
    expect(events.filter((event) => event.type === "turn/end")).toHaveLength(1);
    expect(events.map((event) => event.seq)).toEqual(
      [...events.map((event) => event.seq)].sort((a, b) => a - b)
    );
    expect(events.filter((event) => event.type === "fizz/story-run")).toHaveLength(2);
    expect(events.find((event) => event.type === "user/message")?.data.source).toMatchObject({
      rpcId: projectId,
    });
    expect(JSON.stringify(events)).not.toContain("story_read");
    expect(
      JSON.stringify(
        projectHistory({
          ...history,
          legacyMessages: [
            { id: "user", role: "user", text: "new_york", createdAt: "2026-10-10T00:00:00Z" },
          ],
        })
      )
    ).toContain("new_york");
  });
});
