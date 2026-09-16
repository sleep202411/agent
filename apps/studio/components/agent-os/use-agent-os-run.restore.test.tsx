// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { agentOsApi } from "@/lib/agent-os/api-client";
import { agentOsConversationStorageKey, useAgentOsRun } from "./use-agent-os-run";

vi.mock("@/lib/agent-os/api-client", () => ({
  agentOsApi: {
    getConversation: vi.fn(),
    startRun: vi.fn(),
    cancelRun: vi.fn(),
    listEvents: vi.fn(),
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
  },
}));
const { attach } = vi.hoisted(() => ({ attach: vi.fn(async () => false) }));
vi.mock("@/lib/agent-os/ably-live", () => ({
  AgentOsAblyLive: class {
    detach() {}
    attach = attach;
  },
}));

it.each([
  { empty: false, abandon: true },
  { empty: true, abandon: true },
  { empty: false, abandon: false },
  { empty: true, abandon: false },
])(
  "restores only the current conversation (empty=$empty, abandon=$abandon)",
  async ({ empty, abandon }) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const key = agentOsConversationStorageKey("project-restore");
    localStorage.setItem(key, conversationId);
    let resolve!: (value: unknown) => void;
    vi.mocked(agentOsApi.getConversation).mockReturnValue(
      new Promise<unknown>((done) => {
        resolve = done;
      }) as ReturnType<typeof agentOsApi.getConversation>
    );
    let hook!: ReturnType<typeof useAgentOsRun>;
    function Harness() {
      hook = useAgentOsRun("project-restore");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Harness />));
      if (abandon) await act(async () => hook.newChat());
      await act(async () =>
        resolve({
          conversationId,
          runs: empty
            ? []
            : [
                {
                  runId: "old-run",
                  createdAt: "2026-09-09T00:00:00Z",
                  status: "completed",
                  events: [],
                  assistantText: "Old script",
                },
              ],
        })
      );
      expect(hook.state.conversationId).toBe(abandon ? null : conversationId);
      if (abandon) expect(hook.state.messages).toEqual([]);
      expect(localStorage.getItem(key)).toBe(abandon ? null : conversationId);
    } finally {
      await act(async () => root.unmount());
      localStorage.clear();
    }
  }
);

it.each([false, true])(
  "ignores a late send settlement after new chat (reject=%s)",
  async (reject) => {
    localStorage.clear();
    let settle!: () => void;
    vi.mocked(agentOsApi.startRun).mockImplementation(
      () =>
        new Promise((resolve, fail) => {
          settle = () =>
            reject
              ? fail(new Error("Old request failed"))
              : resolve({
                  runId: "old-run",
                  status: "completed",
                  events: [],
                  assistantText: "Old reply",
                } as Awaited<ReturnType<typeof agentOsApi.startRun>>);
        })
    );
    let hook!: ReturnType<typeof useAgentOsRun>;
    function Harness() {
      hook = useAgentOsRun("project-send");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Harness />));
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = hook
          .send({ message: "Old script", modelProfileId: "model", workbenchMode: "story" })
          .catch(() => undefined);
      });
      await vi.waitFor(() => expect(settle).toBeTypeOf("function"));
      await act(async () => hook.newChat());
      await act(async () => {
        settle();
        await pending;
      });
      expect(hook.state.messages).toEqual([]);
      expect(hook.state.error).toBeNull();
      expect(hook.state.runId).toBeNull();
    } finally {
      await act(async () => root.unmount());
      localStorage.clear();
    }
  }
);

it.each([false, true])("ignores cancellation after reset (reject=%s)", async (reject) => {
  localStorage.clear();
  const old = {
    runId: "old-run",
    status: "completed",
    events: [],
    assistantText: "Old reply",
  } as Awaited<ReturnType<typeof agentOsApi.startRun>>;
  vi.mocked(agentOsApi.startRun).mockResolvedValue(old);
  let finish!: () => void;
  vi.mocked(agentOsApi.cancelRun).mockImplementation(
    () =>
      new Promise((resolve, fail) => {
        finish = () =>
          reject
            ? fail(new Error("Old cancellation failed"))
            : resolve({ ...old, status: "cancelled" } as Awaited<
                ReturnType<typeof agentOsApi.cancelRun>
              >);
      })
  );
  let hook!: ReturnType<typeof useAgentOsRun>;
  function Harness() {
    hook = useAgentOsRun("project-stop");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await hook.send({ message: "Script", modelProfileId: "model", workbenchMode: "story" });
    });
    let pending!: Promise<void>;
    let error: unknown;
    await act(async () => {
      pending = hook.stop().catch((e) => {
        error = e;
      });
    });
    await act(async () => hook.newChat());
    await act(async () => {
      finish();
      await pending;
    });
    expect(error).toBeUndefined();
    expect(hook.state.runId).toBeNull();
    expect(hook.state.messages).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
});

it.each(
  ["approval", "input"].flatMap((kind) =>
    [false, true].flatMap((reject) => [false, true].map((abandon) => ({ kind, reject, abandon })))
  )
)(
  "settles $kind only in its conversation (reject=$reject, abandon=$abandon)",
  async ({ kind, reject, abandon }) => {
    localStorage.clear();
    const approval = {
      kind: "tool",
      approvalId: "approval",
      toolId: "story.author",
      toolCallId: "call",
      arguments: {},
      title: "Save",
      description: "Save script",
    };
    const input = {
      kind: "user_input" as const,
      requestId: "input",
      toolCallId: "call",
      questions: [],
    };
    const old = {
      runId: "decision-run",
      status: kind === "approval" ? "waiting_for_approval" : "waiting_for_input",
      events: [],
      pendingApproval: kind === "approval" ? approval : null,
      pendingUserInput: kind === "input" ? input : null,
    } as Awaited<ReturnType<typeof agentOsApi.startRun>>;
    vi.mocked(agentOsApi.startRun).mockResolvedValue(old);
    let settle!: () => void;
    const deferred = new Promise<Awaited<ReturnType<typeof agentOsApi.startRun>>>(
      (resolve, fail) => {
        settle = () =>
          reject
            ? fail(new Error("Decision failed"))
            : resolve({
                ...old,
                status: "completed",
                pendingApproval: undefined,
                pendingUserInput: undefined,
              });
      }
    );
    vi.mocked(agentOsApi.resolveApproval).mockReturnValue(deferred);
    vi.mocked(agentOsApi.resolveUserInput).mockReturnValue(deferred);
    let hook!: ReturnType<typeof useAgentOsRun>;
    function Harness() {
      hook = useAgentOsRun("project-decision");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => {
        await hook.send({ message: "Script", modelProfileId: "model", workbenchMode: "story" });
      });
      let pending!: Promise<unknown>;
      let error: unknown;
      await act(async () => {
        pending = (
          kind === "approval"
            ? hook.resolveApproval({
                approvalId: "approval",
                decision: "approve",
                responseText: "Save",
                locale: "en-US",
                modelProfileId: "model",
              })
            : hook.resolveUserInput({ requestId: "input", answers: {}, modelProfileId: "model" })
        ).catch((e) => {
          error = e;
        });
      });
      if (abandon) await act(async () => hook.newChat());
      await act(async () => {
        settle();
        await pending;
      });
      if (abandon) {
        expect(hook.state.runId).toBeNull();
        expect(hook.state.messages).toEqual([]);
        expect(error).toBeUndefined();
      } else if (reject) {
        expect(error).toBeInstanceOf(Error);
        expect(
          kind === "approval" ? hook.state.pendingApproval : hook.state.pendingUserInput
        ).not.toBeNull();
      } else {
        expect(hook.state.runId).toBe("decision-run");
        expect(hook.state.pendingApproval).toBeNull();
        expect(hook.state.pendingUserInput).toBeNull();
      }
    } finally {
      await act(async () => root.unmount());
      localStorage.clear();
    }
  }
);

it("ignores a late poll even when transport ignores abort", async () => {
  localStorage.clear();
  const old = { runId: "poll-run", status: "running", events: [] } as Awaited<
    ReturnType<typeof agentOsApi.startRun>
  >;
  vi.mocked(agentOsApi.startRun).mockResolvedValue(old);
  let finish!: () => void;
  vi.mocked(agentOsApi.listEvents).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({ ...old, status: "completed" } as Awaited<
            ReturnType<typeof agentOsApi.listEvents>
          >);
      })
  );
  let hook!: ReturnType<typeof useAgentOsRun>;
  function Harness() {
    hook = useAgentOsRun("project-poll");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await hook.send({ message: "Script", modelProfileId: "model", workbenchMode: "story" });
    });
    expect(finish).toBeTypeOf("function");
    await act(async () => hook.newChat());
    await act(async () => finish());
    expect(hook.state.runId).toBeNull();
    expect(hook.state.messages).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
});

it.each([false, true])(
  "waits for history without reviving a reset turn (reset=%s)",
  async (reset) => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    localStorage.setItem(agentOsConversationStorageKey("project-admission"), conversationId);
    let restore!: () => void;
    vi.mocked(agentOsApi.getConversation).mockReturnValue(
      new Promise((resolve) => {
        restore = () =>
          resolve({ conversationId, runs: [] } as Awaited<
            ReturnType<typeof agentOsApi.getConversation>
          >);
      })
    );
    vi.mocked(agentOsApi.startRun).mockClear();
    vi.mocked(agentOsApi.startRun).mockResolvedValue({
      runId: "new-run",
      status: "completed",
      events: [],
    } as Awaited<ReturnType<typeof agentOsApi.startRun>>);
    let hook!: ReturnType<typeof useAgentOsRun>;
    function Harness() {
      hook = useAgentOsRun("project-admission");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    let pending: Promise<unknown> | undefined;
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => {
        pending = hook.send({
          message: "Continue script",
          modelProfileId: "model",
          workbenchMode: "story",
        });
      });
      expect(agentOsApi.startRun).not.toHaveBeenCalled();
      if (reset) await act(async () => hook.newChat());
      await act(async () => {
        restore();
        await pending;
      });
      if (reset) {
        expect(agentOsApi.startRun).not.toHaveBeenCalled();
        expect(hook.state.runId).toBeNull();
      } else {
        expect(agentOsApi.startRun).toHaveBeenCalledWith(
          expect.objectContaining({ conversationId })
        );
        expect(hook.state.runId).toBe("new-run");
      }
    } finally {
      await act(async () => {
        restore();
        await pending;
        root.unmount();
      });
      localStorage.clear();
    }
  }
);

it("does not reconnect a send after the editor unmounts", async () => {
  localStorage.clear();
  let finish!: () => void;
  vi.mocked(agentOsApi.startRun).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({ runId: "unmounted-run", status: "completed", events: [] } as Awaited<
            ReturnType<typeof agentOsApi.startRun>
          >);
      })
  );
  let hook!: ReturnType<typeof useAgentOsRun>;
  function Harness() {
    hook = useAgentOsRun("project-unmount");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook.send({ message: "Script", modelProfileId: "model", workbenchMode: "story" });
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => root.unmount());
  const calls = attach.mock.calls.length;
  await act(async () => {
    finish();
    await pending;
  });
  expect(attach).toHaveBeenCalledTimes(calls);
  localStorage.clear();
});

it("retains the stored identity when history loading fails", async () => {
  localStorage.clear();
  const conversationId = "00000000-0000-4000-8000-000000000001";
  localStorage.setItem(agentOsConversationStorageKey("project-history-failure"), conversationId);
  vi.mocked(agentOsApi.getConversation).mockRejectedValue(new Error("History unavailable"));
  vi.mocked(agentOsApi.startRun).mockClear();
  vi.mocked(agentOsApi.startRun).mockResolvedValue({
    runId: "retry-run",
    status: "completed",
    events: [],
  } as Awaited<ReturnType<typeof agentOsApi.startRun>>);
  let hook!: ReturnType<typeof useAgentOsRun>;
  function Harness() {
    hook = useAgentOsRun("project-history-failure");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await hook.send({ message: "Continue", modelProfileId: "model", workbenchMode: "story" });
    });
    expect(agentOsApi.startRun).toHaveBeenCalledWith(expect.objectContaining({ conversationId }));
    expect(hook.state.runId).toBe("retry-run");
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
});

it("allows a fresh chat while the abandoned history transport remains pending", async () => {
  localStorage.clear();
  const oldId = "00000000-0000-4000-8000-000000000001";
  localStorage.setItem(agentOsConversationStorageKey("project-fresh"), oldId);
  vi.mocked(agentOsApi.getConversation).mockReturnValue(new Promise(() => {}));
  vi.mocked(agentOsApi.startRun).mockClear();
  vi.mocked(agentOsApi.startRun).mockResolvedValue({
    runId: "fresh-run",
    status: "completed",
    events: [],
  } as Awaited<ReturnType<typeof agentOsApi.startRun>>);
  let hook!: ReturnType<typeof useAgentOsRun>;
  function Harness() {
    hook = useAgentOsRun("project-fresh");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => hook.newChat());
    await act(async () => {
      await hook.send({ message: "Fresh script", modelProfileId: "model", workbenchMode: "story" });
    });
    expect(agentOsApi.startRun).toHaveBeenCalledOnce();
    expect(vi.mocked(agentOsApi.startRun).mock.calls[0]?.[0].conversationId).not.toBe(oldId);
    expect(hook.state.runId).toBe("fresh-run");
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
});
