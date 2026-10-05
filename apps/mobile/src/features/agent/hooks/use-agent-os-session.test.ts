import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentOsSession } from "./use-agent-os-session";

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  startRun: vi.fn(),
  resolveApproval: vi.fn(),
  getConversation: vi.fn(),
  listEvents: vi.fn(),
  cancelRun: vi.fn(),
  answerUserInput: vi.fn(),
  token: "alice",
}));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { id: "alice" },
    session: { region: "com", token: { tokenName: "satoken", tokenValue: api.token } },
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/api-client", () => ({ api: {}, ApiRequestError: class extends Error {} }));
vi.mock("@/i18n", () => ({ getLocale: () => "en-US", t: (key: string) => key }));
vi.mock("../api/agent-os-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/agent-os-api")>()),
  agentOsApi: api,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let canWrite = true;
let root: Root | undefined;
let session: ReturnType<typeof useAgentOsSession>;
const projectId = "0195bcaa-1000-7000-8000-000000000001";
const chapterId = "0195bcaa-1000-7000-8000-000000000002";
async function mount() {
  function Probe() {
    session = useAgentOsSession({ projectId, chapterId, workbenchMode: "story", canWrite });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  api.listModels.mockResolvedValue({ mobileDefaultModelProfileId: "qwen3.7-flash" });
  return async () => {
    await act(async () => root!.render(createElement(Probe)));
  };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  api.token = "alice";
  canWrite = true;
  vi.useRealTimers();
});
it("keeps one user message when the initial response has no events and avoids a model request on every turn", async () => {
  await mount();
  api.startRun
    .mockResolvedValueOnce({ runId: "run-1", status: "completed", events: [] })
    .mockResolvedValueOnce({ runId: "run-2", status: "completed", events: [] });
  await act(async () => session.send("First request"));
  await act(async () => session.send("Second request"));
  expect(
    session.messages.filter((message) => message.role === "user").map((message) => message.text)
  ).toEqual(["First request", "Second request"]);
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.startRun).toHaveBeenCalledWith(
    expect.objectContaining({
      modelProfileId: "qwen3.7-flash",
      workbenchContext: { chapterId, experience: "mobile_h5" },
    }),
    expect.any(AbortSignal)
  );
});
it("uses the server-admitted model for approval when the default changed", async () => {
  await mount();
  api.startRun.mockResolvedValue({
    runId: "run-1",
    status: "waiting_for_approval",
    pendingApproval: { approvalId: "approval-1" },
    events: [
      {
        id: "event-1",
        sequence: 1,
        type: "RunStarted",
        timestamp: new Date().toISOString(),
        data: { modelProfileId: "server-new-model" },
      },
    ],
  });
  api.resolveApproval.mockResolvedValue({ runId: "run-1", status: "completed", events: [] });
  await act(async () => session.send("Continue"));
  expect(session.session.modelProfileId).toBe("server-new-model");
  await act(async () => session.approve("approve"));
  expect(api.resolveApproval).toHaveBeenCalledWith(
    expect.objectContaining({ modelProfileId: "server-new-model", approvalId: "approval-1" }),
    expect.any(AbortSignal)
  );
  expect(session.session.status).toBe("completed");
});

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("claims sends synchronously and abandons model preflight on new chat", async () => {
  await mount();
  const old = deferred();
  api.listModels.mockReturnValueOnce(old.promise);
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = session.send("old");
    void session.send("duplicate");
    void session.restore();
  });
  expect(api.listModels).toHaveBeenCalledTimes(1);
  expect(api.getConversation).not.toHaveBeenCalled();
  const signal = api.listModels.mock.calls[0]![0] as AbortSignal;
  await act(async () => session.newChat());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    old.resolve({ mobileDefaultModelProfileId: "old-model" });
    await pending;
  });
  expect(api.startRun).not.toHaveBeenCalled();
  expect(session.sending).toBe(false);
  expect(session.messages).toEqual([]);
});
it("aborts credential-owned starts and preserves a replacement operation after late completion", async () => {
  const rerender = await mount();
  const old = deferred(),
    next = deferred();
  api.startRun.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const retained = session;
  let oldPending!: Promise<unknown>;
  await act(async () => {
    oldPending = session.send("old");
  });
  const signal = api.startRun.mock.calls[0]![1] as AbortSignal;
  api.token = "bob";
  await rerender();
  expect(signal.aborted).toBe(true);
  expect(session.messages).toEqual([]);
  expect(session.session.conversationId).toBeNull();
  await act(async () => retained.send("retained"));
  expect(api.startRun).toHaveBeenCalledTimes(1);
  let nextPending!: Promise<unknown>;
  await act(async () => {
    nextPending = session.send("new");
  });
  await act(async () => {
    old.resolve({ runId: "old", status: "completed", events: [] });
    await oldPending;
  });
  expect(session.sending).toBe(true);
  expect(session.session.runId).toBeNull();
  await act(async () => {
    next.resolve({ runId: "new", status: "completed", events: [] });
    await nextPending;
  });
  expect(session.session.runId).toBe("new");
  expect(session.sending).toBe(false);
});
it("ignores abandoned restore responses and releases history guards for replacement credentials", async () => {
  const rerender = await mount();
  const old = deferred();
  api.getConversation.mockReturnValue(old.promise);
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = session.restore("old");
  });
  const signal = api.getConversation.mock.calls[0]![2] as AbortSignal;
  api.token = "next";
  await rerender();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    old.resolve({ conversationId: "old", runs: [] });
    await pending;
  });
  expect(session.session.conversationId).toBeNull();
  expect(session.session.status).toBe("idle");
});
it("does not let an abandoned poll publish or detach its replacement", async () => {
  await mount();
  const old = deferred(),
    next = deferred();
  api.startRun
    .mockResolvedValueOnce({ runId: "old", status: "running", events: [] })
    .mockResolvedValueOnce({ runId: "new", status: "running", events: [] });
  api.listEvents.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await act(async () => session.send("old"));
  const oldSignal = api.listEvents.mock.calls[0]![3] as AbortSignal;
  await act(async () => session.newChat());
  expect(oldSignal.aborted).toBe(true);
  await act(async () => session.send("new"));
  const nextSignal = api.listEvents.mock.calls[1]![3] as AbortSignal;
  await act(async () => old.resolve({ runId: "old", status: "completed", events: [] }));
  expect(session.session.runId).toBe("new");
  expect(nextSignal.aborted).toBe(false);
  await act(async () => session.newChat());
  expect(nextSignal.aborted).toBe(true);
  await act(async () => next.resolve({ runId: "new", status: "completed", events: [] }));
  expect(session.session.runId).toBeNull();
});
it.each(["approval", "input", "cancel"])(
  "guards duplicate %s actions and ignores their late failure after leaving",
  async (kind) => {
    const rerender = await mount();
    api.startRun.mockResolvedValue({
      runId: "run",
      status: kind === "input" ? "waiting_for_input" : "waiting_for_approval",
      pendingApproval: { approvalId: "approval" },
      pendingUserInput: {
        requestId: "input",
        questions: [{ id: "question", question: "Continue?", options: [] }],
      },
      events: [],
    });
    await act(async () => session.send("start"));
    const pendingAction = deferred();
    const method =
      kind === "approval"
        ? api.resolveApproval
        : kind === "input"
          ? api.answerUserInput
          : api.cancelRun;
    method.mockReturnValue(pendingAction.promise);
    const invoke = () =>
      kind === "approval"
        ? session.approve("approve")
        : kind === "input"
          ? session.answerUserInput({ answer: "yes" })
          : session.cancel();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = invoke();
      void invoke();
    });
    expect(method).toHaveBeenCalledTimes(1);
    const signal = method.mock.calls[0]!.at(-1) as AbortSignal;
    api.token = "replacement";
    await rerender();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pendingAction.reject(new Error("late"));
      await pending;
    });
    expect(session.session.error).toBeUndefined();
    expect(session.sending).toBe(false);
  }
);

it("settles an abandoned polling delay without starting another request", async () => {
  await mount();
  vi.useFakeTimers();
  api.startRun.mockResolvedValue({ runId: "run", status: "running", events: [] });
  api.listEvents.mockResolvedValue({ runId: "run", status: "running", events: [] });
  await act(async () => session.send("start"));
  expect(api.listEvents).toHaveBeenCalledTimes(1);
  await act(async () => session.newChat());
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(api.listEvents).toHaveBeenCalledTimes(1);
  expect(session.session.status).toBe("idle");
});

it.each(["approval", "input"])(
  "preserves %s retry identity and controls after response loss",
  async (kind) => {
    await mount();
    api.startRun.mockResolvedValue({
      runId: "run",
      status: kind === "approval" ? "waiting_for_approval" : "waiting_for_input",
      pendingApproval: { approvalId: "approval" },
      pendingUserInput: { requestId: "input", questions: [{ id: "q", question: "Continue?" }] },
      events: [],
    });
    await act(async () => session.send("start"));
    const method = kind === "approval" ? api.resolveApproval : api.answerUserInput;
    method
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ runId: "run", status: "completed", events: [] });
    const invoke = (reverse: boolean) =>
      kind === "approval"
        ? session.approve("approve", "Confirmed")
        : session.answerUserInput(reverse ? { b: "2", a: "1" } : { a: "1", b: "2" });
    await act(async () => invoke(false));
    expect(session.session.status).toBe(
      kind === "approval" ? "waiting_for_approval" : "waiting_for_input"
    );
    expect(session.session.error).toBe("response lost");
    expect(session.sending).toBe(false);
    await act(async () => invoke(true));
    expect(method.mock.calls[0]![0].responseId).toBe(method.mock.calls[1]![0].responseId);
    expect(session.session.status).toBe("completed");
  }
);
it("rejects decision and cancel callbacks retained from an earlier run", async () => {
  await mount();
  api.startRun
    .mockResolvedValueOnce({
      runId: "old",
      status: "waiting_for_approval",
      pendingApproval: { approvalId: "old-approval" },
      events: [],
    })
    .mockResolvedValueOnce({ runId: "new", status: "completed", events: [] });
  await act(async () => session.send("old"));
  const old = session;
  await act(async () => session.newChat());
  await act(async () => session.send("new"));
  await act(async () => {
    await old.approve("approve");
    await old.cancel();
  });
  expect(api.resolveApproval).not.toHaveBeenCalled();
  expect(api.cancelRun).not.toHaveBeenCalled();
  expect(session.session.runId).toBe("new");
});
it("allocates a new replay identity when an unaccepted approval payload changes", async () => {
  await mount();
  api.startRun.mockResolvedValue({
    runId: "run",
    status: "waiting_for_approval",
    pendingApproval: { approvalId: "approval" },
    events: [],
  });
  api.resolveApproval.mockRejectedValue(new Error("offline"));
  await act(async () => session.send("start"));
  await act(async () => session.approve("approve", "first"));
  await act(async () => session.approve("reject", "changed"));
  expect(api.resolveApproval.mock.calls[0]![0].responseId).not.toBe(
    api.resolveApproval.mock.calls[1]![0].responseId
  );
});

it("reuses turn identity after response loss, deduplicates the draft message and returns acceptance", async () => {
  await mount();
  api.startRun
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ runId: "accepted", status: "completed", events: [] });
  await act(async () => {
    expect(await session.send("Hello", { skillIds: ["b", "a"] })).toBe(false);
  });
  const first = api.startRun.mock.calls[0][0];
  await act(async () => {
    expect(await session.send("Hello", { skillIds: ["a", "b"] })).toBe(true);
  });
  expect(api.startRun.mock.calls[1][0]).toMatchObject({
    clientSubmissionId: first.clientSubmissionId,
    turnId: first.turnId,
    messageId: first.messageId,
  });
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
});
it("allocates another turn identity for a changed failed draft and after a successful turn", async () => {
  await mount();
  api.startRun
    .mockRejectedValueOnce(new Error("Rejected"))
    .mockResolvedValue({ runId: "accepted", status: "completed", events: [] });
  await act(async () => {
    await session.send("Original");
  });
  await act(async () => {
    await session.send("Changed");
  });
  await act(async () => {
    await session.send("Changed");
  });
  const ids = api.startRun.mock.calls.map(([body]) => body.clientSubmissionId as string);
  expect(new Set(ids).size).toBe(3);
});

it("keeps history readable but rejects retained write callbacks after permission revocation", async () => {
  const rerender = await mount();
  api.startRun.mockResolvedValue({
    runId: "run-1",
    status: "waiting_for_approval",
    pendingApproval: { approvalId: "approval-1" },
    events: [],
  });
  await act(async () => session.send("Edit"));
  const previous = session;
  canWrite = false;
  await rerender();
  await act(async () => {
    expect(await previous.send("Forbidden")).toBe(false);
    await previous.approve("approve");
    await previous.cancel();
    previous.newChat();
  });
  expect(api.startRun).toHaveBeenCalledTimes(1);
  expect(api.resolveApproval).not.toHaveBeenCalled();
  expect(api.cancelRun).not.toHaveBeenCalled();
  expect(session.session.runId).toBe("run-1");
  api.getConversation.mockResolvedValue({ conversationId: "history", runs: [] });
  await act(async () => session.restore());
  expect(api.getConversation).toHaveBeenCalled();
});
it("rejects answers from a retained callback after losing edit access", async () => {
  const rerender = await mount();
  api.startRun.mockResolvedValue({
    runId: "run-1",
    status: "waiting_for_input",
    pendingUserInput: {
      requestId: "input-1",
      questions: [{ id: "q", question: "Q", options: [{ value: "yes", label: "Yes" }] }],
    },
    events: [],
  });
  await act(async () => session.send("Edit"));
  const answer = session.answerUserInput;
  canWrite = false;
  await rerender();
  await act(async () => answer({ q: "yes" }));
  expect(api.answerUserInput).not.toHaveBeenCalled();
});
it("does not start a run if edit access is lost while resolving its model", async () => {
  const rerender = await mount();
  let resolve!: (value: { mobileDefaultModelProfileId: string }) => void;
  api.listModels.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  let sending!: Promise<boolean>;
  await act(async () => {
    sending = session.send("Edit");
  });
  canWrite = false;
  await rerender();
  await act(async () => {
    resolve({ mobileDefaultModelProfileId: "model" });
    expect(await sending).toBe(false);
  });
  expect(api.startRun).not.toHaveBeenCalled();
});

it("still reconciles an already accepted run after edit permission changes", async () => {
  const rerender = await mount();
  let resolve!: (value: { runId: string; status: string; events: never[] }) => void;
  api.startRun.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  let sending!: Promise<boolean>;
  await act(async () => {
    sending = session.send("Already admitted");
  });
  canWrite = false;
  await rerender();
  await act(async () => {
    resolve({ runId: "accepted", status: "completed", events: [] });
    expect(await sending).toBe(true);
  });
  expect(session.session.runId).toBe("accepted");
  expect(api.startRun).toHaveBeenCalledTimes(1);
});
