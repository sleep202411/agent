// @vitest-environment jsdom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_DIRECTING_SKILL_KEY } from "@repo/shared/story-directing-skills";
import {
  useStoryCanvasAssistantSession,
  type StoryCanvasAssistantSession,
  type StoryCanvasUIMessage,
} from "./use-story-canvas-assistant-session";

const sendMessage = vi.fn<(message: StoryCanvasUIMessage) => Promise<void>>(() =>
  Promise.resolve()
);
const setMessages = vi.fn();
const stop = vi.fn(() => Promise.resolve());
const regenerate = vi.fn(() => Promise.resolve());
const clearError = vi.fn();
const { authState } = vi.hoisted(() => ({
  authState: { userId: "user-a" as string | null },
}));
let chatMessages: StoryCanvasUIMessage[] = [];
let chatError: Error | undefined;
let chatStatus: "ready" | "submitted" | "streaming" | "error" = "ready";
let chatOnFinish: ((result: { isAbort: boolean; isError: boolean }) => void) | undefined;

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { onFinish?: typeof chatOnFinish }) => {
    chatOnFinish = options.onFinish;
    return {
      messages: chatMessages,
      sendMessage,
      setMessages,
      status: chatStatus,
      stop,
      error: chatError,
      regenerate,
      clearError,
    };
  },
}));

vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: authState.userId === null ? null : { id: authState.userId },
    loading: authState.userId === null,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Story Canvas assistant session", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: StoryCanvasAssistantSession | null;

  function Harness() {
    session = useStoryCanvasAssistantSession({
      projectId: "project-a",
      workspaceId: "workspace-a",
    });
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    session = null;
    sendMessage.mockClear();
    setMessages.mockClear();
    stop.mockClear();
    regenerate.mockClear();
    clearError.mockClear();
    authState.userId = "user-a";
    chatMessages = [];
    chatError = undefined;
    chatStatus = "ready";
    chatOnFinish = undefined;
    window.sessionStorage.clear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("loads history once, restores its Skill, and blocks sending until it is safe", async () => {
    const historyResponse = deferred<Response>();
    const fetchMock = vi.fn(() => historyResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>
      );
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => session!.setDraft("A story idea"));
    expect(await session!.submit()).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();

    const persistedMessages = [
      { id: "history-1", role: "user", parts: [] },
      { id: "history-2", role: "assistant", parts: [] },
    ];
    await act(async () => {
      historyResponse.resolve(
        new Response(
          JSON.stringify({
            conversationId: "story-canvas:project-a",
            messages: persistedMessages,
            selectedSkillKeys: [STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE],
            revision: 2,
            sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
            status: "ready",
            resetAvailable: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      await historyResponse.promise;
      await Promise.resolve();
    });

    expect(setMessages).toHaveBeenCalledWith(persistedMessages);
    expect(session!.selectedSkillKey).toBe(STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE);
    await act(async () => {
      expect(await session!.submit()).toBe(true);
    });
    expect(sendMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      role: "user",
      parts: [{ type: "text", text: "A story idea" }],
    });
  });

  it("fails closed without clearing the draft when recovery storage is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            conversationId: "story-canvas:project-a",
            messages: [],
            selectedSkillKeys: [],
            revision: 0,
            sessionId: null,
            status: "ready",
            resetAvailable: true,
          })
        )
      )
    );
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => session!.setDraft("Keep this exact draft"));
    const storageFailure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });

    await act(async () => {
      await expect(session!.submit()).resolves.toBe(false);
    });

    expect(session!.draft).toBe("Keep this exact draft");
    expect(session!.recoveryStorageError).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    storageFailure.mockRestore();
  });

  it("clears a transient recovery error once the authenticated storage scope is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            conversationId: "story-canvas:project-a",
            messages: [],
            selectedSkillKeys: [],
            revision: 0,
            sessionId: null,
            status: "ready",
            resetAvailable: true,
          })
        )
      )
    );
    authState.userId = null;
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => session!.setDraft("Wait for identity"));
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(false);
    });
    expect(session!.recoveryStorageError).toBe(true);
    expect(session!.draft).toBe("Wait for identity");

    authState.userId = "user-a";
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(session!.recoveryReady).toBe(true);
    expect(session!.recoveryStorageError).toBe(false);
    expect(session!.draft).toBe("Wait for identity");
  });

  it("persists an ambiguous turn with its exact Skill across unmount and reload", async () => {
    const readyEmpty = () =>
      Response.json({
        conversationId: "story-canvas:project-a",
        messages: [],
        selectedSkillKeys: [],
        revision: 0,
        sessionId: null,
        status: "ready",
        resetAvailable: true,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(readyEmpty()))
    );
    sendMessage.mockRejectedValueOnce(new Error("Network disconnected"));

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      session!.setSelectedSkillKey(STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK);
      session!.setDraft("A dream in a moonlit garden");
    });
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
      await Promise.resolve();
    });
    const submitted = sendMessage.mock.calls[0]![0] as StoryCanvasUIMessage;
    const stored = [...Array(window.sessionStorage.length).keys()]
      .map((index) => window.sessionStorage.getItem(window.sessionStorage.key(index)!))
      .find(Boolean);
    expect(JSON.parse(stored!).turn).toEqual({
      message: submitted,
      metadata: { selectedSkillKey: STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK },
    });

    await act(async () => root.unmount());
    root = createRoot(container);
    chatError = undefined;
    chatMessages = [];
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(session!.recoveredMessage).toEqual(submitted);
  });

  it("discards a preserved turn from memory and storage on explicit dismissal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            conversationId: "story-canvas:project-a",
            messages: [],
            selectedSkillKeys: [],
            revision: 0,
            sessionId: null,
            status: "ready",
            resetAvailable: true,
          })
        )
      )
    );
    sendMessage.mockRejectedValueOnce(new Error("Network disconnected"));

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => session!.setDraft("Keep or discard me"));
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
      await Promise.resolve();
    });
    expect(session!.recoveredMessage).not.toBeNull();
    expect(window.sessionStorage.length).toBeGreaterThan(0);

    await act(async () => {
      session!.discardRecoveredMessage();
      await Promise.resolve();
    });

    expect(session!.recoveredMessage).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("reconciles a losing-tab 409 while preserving the optimistic message for retry", async () => {
    const readyEnvelope = (messages: StoryCanvasUIMessage[], revision: number) =>
      new Response(
        JSON.stringify({
          conversationId: "story-canvas:project-a",
          messages,
          selectedSkillKeys: [],
          revision,
          sessionId: revision === 0 ? null : "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status: "ready",
          resetAvailable: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const canonicalMessages: StoryCanvasUIMessage[] = [
      { id: "other-user", role: "user", parts: [{ type: "text", text: "Other tab" }] },
      {
        id: "other-assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Canonical response" }],
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(readyEnvelope([], 0))
      .mockResolvedValueOnce(readyEnvelope(canonicalMessages, 2));
    vi.stubGlobal("fetch", fetchMock);
    const pendingSend = deferred<void>();
    sendMessage.mockReturnValueOnce(pendingSend.promise);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => session!.setDraft("Do not lose this"));
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
    });
    const optimistic = sendMessage.mock.calls[0]![0] as StoryCanvasUIMessage;
    chatError = new Error(
      JSON.stringify({
        code: "COPILOT_STREAM_IN_PROGRESS",
        message: "Another tab is responding.",
        action: "refresh_history",
      })
    );
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setMessages).toHaveBeenLastCalledWith(canonicalMessages);
    expect(session!.recoveredMessage).toEqual(optimistic);

    fetchMock.mockResolvedValueOnce(readyEnvelope(canonicalMessages, 2)).mockResolvedValueOnce(
      readyEnvelope(
        [
          ...canonicalMessages,
          optimistic,
          {
            id: "retried-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "Retried response" }],
          },
        ],
        4
      )
    );

    await act(async () => {
      await expect(session!.retryRecoveredMessage()).resolves.toBe(true);
    });
    expect(sendMessage).toHaveBeenLastCalledWith({
      id: optimistic.id,
      role: "user",
      parts: optimistic.parts,
    });
  });

  it("preserves a pre-claim network failure and rechecks canonical history before resending", async () => {
    const readyEnvelope = (messages: StoryCanvasUIMessage[], revision: number) =>
      new Response(
        JSON.stringify({
          conversationId: "story-canvas:project-a",
          messages,
          selectedSkillKeys: [],
          revision,
          sessionId: revision === 0 ? null : "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status: "ready",
          resetAvailable: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const fetchMock = vi.fn().mockResolvedValueOnce(readyEnvelope([], 0));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => session!.setDraft("Survive the disconnect"));
    await act(async () => {
      expect(await session!.submit()).toBe(true);
    });
    const submitted = sendMessage.mock.calls[0]![0] as StoryCanvasUIMessage;

    act(() => chatOnFinish?.({ isAbort: false, isError: true }));
    expect(session!.recoveredMessage).toEqual(submitted);

    fetchMock.mockResolvedValueOnce(readyEnvelope([], 0)).mockResolvedValueOnce(
      readyEnvelope(
        [
          submitted,
          {
            id: "network-retry-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "Recovered" }],
          },
        ],
        2
      )
    );

    await act(async () => {
      await expect(session!.retryRecoveredMessage()).resolves.toBe(true);
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(submitted);
    expect(fetchMock.mock.invocationCallOrder[1]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[1]!
    );
    expect(session!.recoveredMessage).toBeNull();
  });

  it("regenerates instead of resending when canonical history already claimed the message", async () => {
    const envelope = (
      messages: StoryCanvasUIMessage[],
      revision: number,
      status: "ready" | "failed"
    ) =>
      new Response(
        JSON.stringify({
          conversationId: "story-canvas:project-a",
          messages,
          selectedSkillKeys: [],
          revision,
          sessionId: revision === 0 ? null : "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status,
          resetAvailable: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope([], 0, "ready"));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => session!.setDraft("Claim this once"));
    await act(async () => {
      expect(await session!.submit()).toBe(true);
    });
    const submitted = sendMessage.mock.calls[0]![0] as StoryCanvasUIMessage;
    act(() => chatOnFinish?.({ isAbort: false, isError: true }));

    fetchMock.mockResolvedValueOnce(envelope([submitted], 1, "failed")).mockResolvedValueOnce(
      envelope(
        [
          submitted,
          {
            id: "regenerated-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "Regenerated" }],
          },
        ],
        2,
        "ready"
      )
    );

    await act(async () => {
      await expect(session!.retryRecoveredMessage()).resolves.toBe(true);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(session!.recoveredMessage).toBeNull();
  });

  it("refreshes an intentional stop to aborted and exposes canonical regeneration without an error", async () => {
    const user: StoryCanvasUIMessage = {
      id: "stopped-user",
      role: "user",
      parts: [{ type: "text", text: "Stop midway" }],
    };
    const envelope = (
      messages: StoryCanvasUIMessage[],
      revision: number,
      status: "ready" | "aborted"
    ) =>
      new Response(
        JSON.stringify({
          conversationId: "story-canvas:project-a",
          messages,
          selectedSkillKeys: [],
          revision,
          sessionId: revision === 0 ? null : "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status,
          resetAvailable: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope([], 0, "ready"))
      .mockResolvedValueOnce(envelope([user], 1, "aborted"))
      .mockResolvedValueOnce(envelope([user], 1, "aborted"))
      .mockResolvedValueOnce(
        envelope(
          [
            user,
            {
              id: "stopped-retry-assistant",
              role: "assistant",
              parts: [{ type: "text", text: "Completed after retry" }],
            },
          ],
          2,
          "ready"
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    chatMessages = [user];
    chatStatus = "streaming";
    await act(async () => {
      root.render(<Harness />);
      session!.stop();
      chatOnFinish?.({ isAbort: true, isError: false });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session!.recoveredMessage).toBeNull();
    expect(session!.history.conversationStatus).toBe("aborted");

    chatStatus = "ready";
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      await expect(session!.regenerate()).resolves.toBe(true);
    });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(session!.history.conversationStatus).toBe("ready");
  });

  it("resets every local recovery surface only after authoritative reset reload", async () => {
    const readyEnvelope = (messages: StoryCanvasUIMessage[], revision = 0) =>
      Response.json({
        conversationId: "story-canvas:project-a",
        messages,
        selectedSkillKeys: [],
        revision,
        sessionId: revision === 0 ? null : "019f7243-20c1-7054-a6fa-0a33da6efef5",
        status: "ready",
        resetAvailable: true,
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(readyEnvelope([]))
      .mockResolvedValueOnce(readyEnvelope([]))
      .mockResolvedValueOnce(
        Response.json({ conversationId: "story-canvas:project-a", reset: true })
      )
      .mockResolvedValueOnce(readyEnvelope([]));
    vi.stubGlobal("fetch", fetchMock);
    const pendingSend = deferred<void>();
    sendMessage.mockReturnValueOnce(pendingSend.promise);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      session!.setSelectedSkillKey(STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK);
      session!.setDraft("An ambiguous request");
    });
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
    });
    act(() => chatOnFinish?.({ isAbort: false, isError: true }));
    expect(session!.recoveredMessage).not.toBeNull();

    act(() => {
      session!.setDraft("Unsent follow-up");
    });

    await act(async () => {
      await expect(session!.startNewConversation()).resolves.toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(session!.recoveredMessage).toBeNull();
    expect(session!.recoveryStorageError).toBe(false);
    expect(session!.draft).toBe("");
    expect(session!.selectedSkillKey).toBeNull();
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(0);
  });

  const DOCUMENT_REF = {
    documentId: "019f7243-20c1-7054-a6fa-0a33da6efe10",
    name: "script.txt",
    mediaType: "text/plain",
    sizeBytes: 9,
    charCount: 9,
  };

  function routedFetch(documentResponse: () => Response) {
    return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/aurora/copilot/documents")) {
        return Promise.resolve(documentResponse());
      }
      return Promise.resolve(
        Response.json({
          conversationId: "story-canvas:project-a",
          messages: [],
          selectedSkillKeys: [],
          revision: 0,
          sessionId: null,
          status: "ready",
          resetAvailable: true,
        })
      );
    });
  }

  it("uploads the attachment on send and carries only its reference part", async () => {
    const fetchMock = routedFetch(() => Response.json({ document: DOCUMENT_REF }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const file = new File(["INT. GATE"], "script.txt", { type: "text/plain" });
    act(() => {
      expect(session!.attachDocument(file)).toBe(true);
      session!.setDraft("Build the skeleton from my script");
    });
    expect(session!.attachment).toBe(file);

    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
      await Promise.resolve();
    });

    const uploadCall = fetchMock.mock.calls.find(([input]) =>
      String(typeof input === "string" ? input : (input as Request).url).includes(
        "/aurora/copilot/documents"
      )
    );
    expect(uploadCall).toBeDefined();
    const uploadInit = uploadCall![1] as RequestInit;
    expect(uploadInit.method).toBe("POST");
    const form = uploadInit.body as FormData;
    expect(form.get("conversationId")).toBe("story-canvas:project-a");
    expect(form.get("projectId")).toBe("project-a");
    expect(form.get("mode")).toBe("story-canvas");
    expect((form.get("file") as File).name).toBe("script.txt");

    expect(sendMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      role: "user",
      parts: [
        { type: "text", text: "Build the skeleton from my script" },
        { type: "data-document", data: DOCUMENT_REF },
      ],
    });
    expect(session!.attachment).toBeNull();
    expect(session!.attachmentError).toBeNull();
  });

  it("sends a document-only message without any draft text", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch(() => Response.json({ document: DOCUMENT_REF }))
    );
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      session!.attachDocument(new File(["INT. GATE"], "script.txt"));
    });
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
    });
    expect(sendMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      role: "user",
      parts: [{ type: "data-document", data: DOCUMENT_REF }],
    });
  });

  it("keeps the draft and attachment when the upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch(
        () =>
          new Response(
            JSON.stringify({
              code: "COPILOT_DOCUMENT_TEXT_TOO_LARGE",
              message: "Too large.",
            }),
            { status: 413, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const file = new File(["INT. GATE"], "script.txt");
    act(() => {
      session!.attachDocument(file);
      session!.setDraft("Keep this draft");
    });

    await act(async () => {
      await expect(session!.submit()).resolves.toBe(false);
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(session!.draft).toBe("Keep this draft");
    expect(session!.attachment).toBe(file);
    expect(session!.attachmentError).toBe("uploadFailed");
  });

  it("rejects unsupported and oversized files at attach time", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch(() => Response.json({ document: DOCUMENT_REF }))
    );
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      expect(session!.attachDocument(new File(["%PDF"], "script.pdf"))).toBe(false);
    });
    expect(session!.attachment).toBeNull();
    expect(session!.attachmentError).toBe("unsupported");

    const oversized = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], "big.txt");
    act(() => {
      expect(session!.attachDocument(oversized)).toBe(false);
    });
    expect(session!.attachment).toBeNull();
    expect(session!.attachmentError).toBe("tooLarge");

    act(() => {
      expect(session!.attachDocument(new File(["ok"], "fine.md"))).toBe(true);
    });
    expect(session!.attachmentError).toBeNull();
    act(() => session!.removeAttachment());
    expect(session!.attachment).toBeNull();
  });

  it("preserves a failed document turn for recovery across reload", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch(() => Response.json({ document: DOCUMENT_REF }))
    );
    sendMessage.mockRejectedValueOnce(new Error("Network disconnected"));

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      session!.attachDocument(new File(["INT. GATE"], "script.txt"));
      session!.setDraft("Adapt my script");
    });
    await act(async () => {
      await expect(session!.submit()).resolves.toBe(true);
      await Promise.resolve();
    });
    const submitted = sendMessage.mock.calls[0]![0] as StoryCanvasUIMessage;
    expect(submitted.parts).toHaveLength(2);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(session!.recoveredMessage).toEqual(submitted);
  });

  it("preserves every local recovery surface when authoritative reset reload fails", async () => {
    const readyEnvelope = () =>
      Response.json({
        conversationId: "story-canvas:project-a",
        messages: [],
        selectedSkillKeys: [],
        revision: 0,
        sessionId: null,
        status: "ready",
        resetAvailable: true,
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(readyEnvelope())
      .mockResolvedValueOnce(readyEnvelope())
      .mockResolvedValueOnce(
        Response.json({ conversationId: "story-canvas:project-a", reset: true })
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      session!.setSelectedSkillKey(STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK);
      session!.setDraft("Keep this local idea");
    });

    await act(async () => {
      await expect(session!.startNewConversation()).resolves.toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(session!.draft).toBe("Keep this local idea");
    expect(session!.selectedSkillKey).toBe(STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK);
    expect(clearError).not.toHaveBeenCalled();
  });
});
