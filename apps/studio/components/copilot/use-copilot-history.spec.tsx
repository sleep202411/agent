// @vitest-environment jsdom

import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotHistory } from "./use-copilot-history";

let retained: ReturnType<typeof useCopilotHistory<UIMessage>>;

interface PendingHistoryRequest {
  input: RequestInfo | URL;
  init?: RequestInit;
  resolve: (response: Response) => void;
}

function Harness({
  conversationId,
  workspaceId = "workspace-1",
  mode,
  projectId,
}: {
  conversationId: string;
  workspaceId?: string;
  mode?: "canvas" | "story-canvas";
  projectId?: string;
}) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [resetResult, setResetResult] = useState<"idle" | "true" | "false">("idle");
  const history = useCopilotHistory({
    conversationId,
    workspaceId,
    mode,
    projectId,
    setMessages,
  });
  useLayoutEffect(() => {
    retained = history;
  });
  return (
    <div>
      <span data-status>{history.status}</span>
      <span data-message>{messages[0]?.id ?? "none"}</span>
      <span data-error>{history.error?.message ?? "localized-fallback"}</span>
      <span data-reset-result>{resetResult}</span>
      <button
        data-reset
        type="button"
        onClick={() =>
          void history.reset().then((result) => setResetResult(String(result) as "true" | "false"))
        }
      >
        reset
      </button>
    </div>
  );
}

describe("useCopilotHistory", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: PendingHistoryRequest[];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            requests.push({ input, init, resolve });
          })
      )
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["retry", "reset"] as const)(
    "rejects retained %s callbacks after unmount",
    async (action) => {
      await act(async () => root.render(<Harness conversationId="conversation-a" />));
      const callback = retained[action];
      await act(async () => root.render(null));
      // A stale caller must not start another request; deliberately do not await
      // an unfixed callback because its mocked HTTP request remains pending.
      await act(async () => {
        void callback();
      });
      expect(requests).toHaveLength(1);
    }
  );

  it("cannot apply a late history response from a previous conversation", async () => {
    await act(async () => {
      root.render(<Harness conversationId="conversation-a" />);
      await Promise.resolve();
    });
    expect(requests).toHaveLength(1);

    await act(async () => {
      root.render(<Harness conversationId="conversation-b" />);
      await Promise.resolve();
    });
    expect(requests).toHaveLength(2);
    expect(container.querySelector("[data-status]")?.textContent).toBe("loading");

    await act(async () => {
      requests[0]?.resolve(
        Response.json({
          conversationId: "conversation-a",
          messages: [{ id: "message-a", role: "user", parts: [] }],
          revision: 1,
          sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status: "failed",
          resetAvailable: true,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-message]")?.textContent).toBe("none");

    await act(async () => {
      requests[1]?.resolve(
        Response.json({
          conversationId: "conversation-b",
          messages: [
            { id: "message-b", role: "user", parts: [] },
            { id: "message-b-response", role: "assistant", parts: [] },
          ],
          revision: 2,
          sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef6",
          status: "ready",
          resetAvailable: true,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-status]")?.textContent).toBe("ready");
    expect(container.querySelector("[data-message]")?.textContent).toBe("message-b");
  });

  it.each([200, 409])(
    "ignores an old reset response (%s) after conversation replacement",
    async (status) => {
      const canonical = (conversationId: string) => ({
        conversationId,
        messages: [],
        revision: 0,
        sessionId: null,
        status: "ready",
        resetAvailable: true,
      });
      await act(async () => {
        root.render(<Harness conversationId="conversation-a" />);
      });
      await act(async () => {
        requests[0]?.resolve(Response.json(canonical("conversation-a")));
      });
      await act(async () => {
        (container.querySelector("[data-reset]") as HTMLButtonElement).click();
      });
      await act(async () => {
        requests[1]?.resolve(Response.json(canonical("conversation-a")));
      });
      expect(String(requests[2]?.input)).toBe("/aurora/copilot/reset");
      await act(async () => {
        root.render(<Harness conversationId="conversation-b" />);
      });
      const replacement = requests[3];
      await act(async () => {
        requests[2]?.resolve(Response.json({ message: "old reset" }, { status }));
      });
      expect(requests).toHaveLength(4);
      expect(replacement?.init?.signal?.aborted).toBe(false);
      await act(async () => {
        replacement?.resolve(Response.json(canonical("conversation-b")));
      });
      expect(container.querySelector("[data-status]")?.textContent).toBe("ready");
      expect(container.querySelector("[data-error]")?.textContent).toBe("localized-fallback");
    }
  );

  it("cancels an in-flight reset on departure and allows the replacement conversation to reset", async () => {
    const canonical = (conversationId: string) => ({
      conversationId,
      messages: [],
      revision: 0,
      sessionId: null,
      status: "ready",
      resetAvailable: true,
    });
    await act(async () => {
      root.render(<Harness conversationId="conversation-a" />);
    });
    await act(async () => {
      requests[0]?.resolve(Response.json(canonical("conversation-a")));
    });
    await act(async () => {
      (container.querySelector("[data-reset]") as HTMLButtonElement).click();
    });
    await act(async () => {
      requests[1]?.resolve(Response.json(canonical("conversation-a")));
    });
    await act(async () => {
      root.render(<Harness conversationId="conversation-b" />);
    });
    expect(requests[2]?.init?.signal?.aborted).toBe(true);
    await act(async () => {
      requests[3]?.resolve(Response.json(canonical("conversation-b")));
    });
    await act(async () => {
      (container.querySelector("[data-reset]") as HTMLButtonElement).click();
    });
    expect(requests).toHaveLength(5);
    await act(async () => {
      requests[4]?.resolve(Response.json(canonical("conversation-b")));
    });
    expect(String(requests[5]?.input)).toBe("/aurora/copilot/reset");
    await act(async () => {
      requests[2]?.resolve(Response.json({ reset: true }));
    });
    expect(requests).toHaveLength(6);
    expect(requests[5]?.init?.signal?.aborted).toBe(false);
  });

  it("keeps local contract failures behind the localized UI fallback", async () => {
    await act(async () => {
      root.render(<Harness conversationId="conversation-a" />);
      await Promise.resolve();
    });

    await act(async () => {
      requests[0]?.resolve(
        Response.json({
          conversationId: "conversation-a",
          messages: [{ id: "broken", role: "assistant" }],
        })
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-status]")?.textContent).toBe("error");
    expect(container.querySelector("[data-error]")?.textContent).toBe("localized-fallback");
  });

  it("keeps a streaming canonical conversation read-only and polls through completion", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(<Harness conversationId="conversation-a" />);
      await Promise.resolve();
    });
    await act(async () => {
      requests[0]?.resolve(
        Response.json({
          conversationId: "conversation-a",
          messages: [{ id: "message-a", role: "user", parts: [] }],
          revision: 1,
          sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status: "streaming",
          resetAvailable: true,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-status]")?.textContent).toBe("loading");
    expect(container.querySelector("[data-message]")?.textContent).toBe("message-a");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(requests).toHaveLength(2);
    await act(async () => {
      requests[1]?.resolve(
        Response.json({
          conversationId: "conversation-a",
          messages: [
            { id: "message-a", role: "user", parts: [] },
            { id: "response-a", role: "assistant", parts: [] },
          ],
          revision: 2,
          sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
          status: "ready",
          resetAvailable: true,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-status]")?.textContent).toBe("ready");
  });

  it("refreshes the latest revision and session before an explicit reset CAS", async () => {
    const canonical = {
      conversationId: "conversation-a",
      messages: [
        { id: "message-a", role: "user", parts: [] },
        { id: "response-a", role: "assistant", parts: [] },
      ],
      revision: 4,
      sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
      status: "ready",
      resetAvailable: true,
    };
    await act(async () => {
      root.render(<Harness conversationId="conversation-a" />);
      await Promise.resolve();
      requests[0]?.resolve(Response.json(canonical));
      await Promise.resolve();
    });

    await act(async () => {
      (container.querySelector("[data-reset]") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(requests).toHaveLength(2);
    await act(async () => {
      requests[1]?.resolve(Response.json(canonical));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests).toHaveLength(3);
    expect(String(requests[2]?.input)).toBe("/aurora/copilot/reset");
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      conversationId: "conversation-a",
      expectedRevision: 4,
      expectedSessionId: canonical.sessionId,
    });
    await act(async () => {
      requests[2]?.resolve(Response.json({ conversationId: "conversation-a", reset: true }));
      await Promise.resolve();
    });
    expect(requests).toHaveLength(4);
    await act(async () => {
      requests[3]?.resolve(
        Response.json({
          conversationId: "conversation-a",
          messages: [],
          revision: 0,
          sessionId: null,
          status: "ready",
          resetAvailable: true,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-status]")?.textContent).toBe("ready");
    expect(container.querySelector("[data-message]")?.textContent).toBe("none");
    expect(container.querySelector("[data-reset-result]")?.textContent).toBe("true");
  });

  it("does not report reset complete when canonical state cannot be reloaded", async () => {
    const canonical = {
      conversationId: "conversation-a",
      messages: [
        { id: "message-a", role: "user", parts: [] },
        { id: "response-a", role: "assistant", parts: [] },
      ],
      revision: 4,
      sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
      status: "ready",
      resetAvailable: true,
    };
    await act(async () => {
      root.render(<Harness conversationId="conversation-a" />);
      await Promise.resolve();
    });
    await act(async () => {
      requests[0]?.resolve(Response.json(canonical));
      await Promise.resolve();
    });
    expect(container.querySelector("[data-message]")?.textContent).toBe("message-a");

    await act(async () => {
      (container.querySelector("[data-reset]") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await act(async () => {
      requests[1]?.resolve(Response.json(canonical));
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
    await act(async () => {
      requests[2]?.resolve(Response.json({ conversationId: "conversation-a", reset: true }));
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
    await act(async () => {
      requests[3]?.resolve(new Response("unavailable", { status: 503 }));
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });

    expect(container.querySelector("[data-reset-result]")?.textContent).toBe("false");
    expect(container.querySelector("[data-status]")?.textContent).toBe("error");
    expect(container.querySelector("[data-message]")?.textContent).toBe("message-a");
  });

  it("keeps reset in the exact canvas scope and accepts a new ABA session after deletion", async () => {
    const projectId = "019f7243-20c1-7054-a6fa-0a33da6efef2";
    const workspaceId = "019f7243-20c1-7054-a6fa-0a33da6efef1";
    const conversationId = `story-canvas:${projectId}`;
    const beforeReset = {
      conversationId,
      messages: [
        { id: "old-session-user", role: "user", parts: [] },
        { id: "old-session-assistant", role: "assistant", parts: [] },
      ],
      revision: 7,
      sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
      status: "ready",
      resetAvailable: true,
    };

    await act(async () => {
      root.render(
        <Harness
          conversationId={conversationId}
          workspaceId={workspaceId}
          mode="story-canvas"
          projectId={projectId}
        />
      );
      await Promise.resolve();
      requests[0]?.resolve(Response.json(beforeReset));
      await Promise.resolve();
    });

    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      conversationId,
      mode: "story-canvas",
      projectId,
    });
    expect(new Headers(requests[0]?.init?.headers).get("x-fizz-workspace-id")).toBe(workspaceId);

    await act(async () => {
      (container.querySelector("[data-reset]") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await act(async () => {
      requests[1]?.resolve(Response.json(beforeReset));
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
    expect(String(requests[2]?.input)).toBe("/aurora/copilot/reset");
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      conversationId,
      expectedRevision: 7,
      expectedSessionId: beforeReset.sessionId,
      mode: "story-canvas",
      projectId,
    });
    expect(new Headers(requests[2]?.init?.headers).get("x-fizz-workspace-id")).toBe(workspaceId);

    await act(async () => {
      requests[2]?.resolve(Response.json({ conversationId, reset: true }));
      await Promise.resolve();
    });
    const afterReset = {
      conversationId,
      messages: [
        { id: "new-session-user", role: "user", parts: [] },
        { id: "new-session-assistant", role: "assistant", parts: [] },
      ],
      revision: 1,
      sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef6",
      status: "ready",
      resetAvailable: true,
    };
    await act(async () => {
      requests[3]?.resolve(Response.json(afterReset));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-status]")?.textContent).toBe("ready");
    expect(container.querySelector("[data-message]")?.textContent).toBe("new-session-user");
  });
});
