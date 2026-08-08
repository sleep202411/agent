// @vitest-environment jsdom

import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioAgentError } from "@repo/shared";

import messages from "@/messages/en-US.json";
import type {
  StudioAgentFailedRunView,
  StudioAgentMessageView,
  StudioAgentTimelineItemView,
} from "@/lib/studio-agent";
import type { StoryChapter } from "@/lib/story-projects-api";

import {
  StoryCanvasAssistantLayer,
  type StoryCanvasFirstOpenInputs,
} from "./story-canvas-assistant-layer";

const hooks = vi.hoisted(() => ({
  useStoryStudioAgentBootstrap: vi.fn(),
  useDisconnectedStoryStudioAgentSession: vi.fn(),
  useStoryStudioAgentSession: vi.fn(),
}));

/** Props the transport providers were mounted with, captured per render. */
const providers = vi.hoisted(() => ({
  ably: [] as unknown[],
  chatTransport: [] as Record<string, unknown>[],
}));

vi.mock("./use-story-studio-agent", () => hooks);

vi.mock("ably/react", () => ({
  AblyProvider: ({ client, children }: { client: unknown; children: ReactNode }) => {
    providers.ably.push(client);
    return children;
  },
}));

vi.mock("@ably/ai-transport/vercel/react", () => ({
  ChatTransportProvider: ({ children, ...rest }: { children: ReactNode }) => {
    providers.chatTransport.push(rest as Record<string, unknown>);
    return children;
  },
}));

describe("StoryCanvasAssistantLayer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    providers.ably.length = 0;
    providers.chatTransport.length = 0;
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(createBootstrap());
    hooks.useDisconnectedStoryStudioAgentSession.mockImplementation(() => createSession());
    hooks.useStoryStudioAgentSession.mockImplementation(() => createSession());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the runtime mounted while closed and splits the page when opened", async () => {
    await renderLayer(root, false);

    // Closed: the canvas region stands alone in the split — no panel column.
    const closedRegion = container.querySelector<HTMLElement>(
      '[data-slot="studio-agent-canvas-region"]'
    );
    expect(closedRegion?.querySelector('[data-testid="story-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="studio-agent-surface"]')).toBeNull();
    // Closed: the bootstrap is alive, but it is told not to hold a channel.
    expect(hooks.useStoryStudioAgentBootstrap).toHaveBeenCalledWith({
      projectId: "project-1",
      chapterId: "chapter-1",
      workspaceId: "workspace-1",
      active: false,
    });

    await renderLayer(root, true);

    // Open: canvas region and StoryOS column are SIBLINGS of one split
    // container. The panel is in-flow — never an absolute overlay that could
    // hide the canvas content beneath it.
    const split = container.querySelector<HTMLElement>('[data-slot="studio-agent-split"]');
    const region = container.querySelector<HTMLElement>('[data-slot="studio-agent-canvas-region"]');
    const surface = container.querySelector<HTMLElement>('[data-slot="studio-agent-surface"]');
    expect(split).not.toBeNull();
    expect(region?.parentElement).toBe(split);
    expect(surface?.parentElement).toBe(split);
    expect(surface?.classList.contains("absolute")).toBe(false);
    // The canvas lives in the shrinking region, never inside the panel column.
    expect(region?.querySelector('[data-testid="story-canvas"]')).not.toBeNull();
    expect(surface?.querySelector('[data-testid="story-canvas"]')).toBeNull();
    expect(hooks.useStoryStudioAgentBootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true })
    );
  });

  it("treats an open panel buried under a deeper canvas as unattended", async () => {
    // `suspended` renders the whole layer inert and invisible. Holding a
    // channel for a panel nobody can see or reach spends a capped resource on
    // nothing.
    await renderLayer(root, true, { suspended: true });

    expect(hooks.useStoryStudioAgentBootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false })
    );
  });

  it("renders the persisted transcript with no session until the grant resolves", async () => {
    await renderLayer(root, true);

    expect(providers.chatTransport).toHaveLength(0);
    expect(hooks.useStoryStudioAgentSession).not.toHaveBeenCalled();
    expect(hooks.useDisconnectedStoryStudioAgentSession).toHaveBeenCalled();
  });

  it("opens the conversation on the channel the server signed, never one it rebuilt", async () => {
    const client = { id: "ably-client" };
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(createBootstrap({ realtime: live(client) }));

    await renderLayer(root, true);

    expect(new Set(providers.ably)).toEqual(new Set([client]));
    expect(providers.chatTransport[0]).toMatchObject({
      channelName: `agent:v1:conversation:${THREAD_ID}`,
      api: "/aurora/agent-platform/invocations",
      credentials: "include",
    });
    expect(hooks.useStoryStudioAgentSession).toHaveBeenCalled();
  });

  it("adds product routing to an approval continuation while the SDK owns its wire input", async () => {
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({
        realtime: live({ id: "ably-client" }),
        invocations: [waitingInvocation()],
      })
    );

    await renderLayer(root, true);
    const prepare = (
      providers.chatTransport.at(-1)?.chatOptions as {
        prepareSendMessagesRequest: (input: Record<string, unknown>) => {
          body?: Record<string, unknown>;
          headers?: Record<string, string>;
        };
      }
    ).prepareSendMessagesRequest;

    const prepared = prepare({
      trigger: "submit-message",
      messages: [],
      history: [APPROVED_ASSISTANT],
    });

    expect(prepared.body).toEqual({
      schemaVersion: "agent-invocation-gateway/v1",
      conversationId: THREAD_ID,
      clientMessageId: expect.any(String),
      continuationOfInvocationId: INVOCATION_ID,
      locale: "en-US",
    });
    expect(prepared.body?.clientMessageId).not.toBe(APPROVED_ASSISTANT.id);
    expect(prepared.headers).toEqual({
      "x-fizz-workspace-id": "workspace-1",
      "accept-language": "en-US",
    });

    const nextApproval = prepare({
      trigger: "submit-message",
      messages: [],
      history: [APPROVED_ASSISTANT],
    });
    expect(nextApproval.body?.continuationOfInvocationId).toBe(INVOCATION_ID);
    expect(nextApproval.body?.clientMessageId).not.toBe(prepared.body?.clientMessageId);
  });

  it("refuses an orphaned approval continuation instead of starting a second root Run", async () => {
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({
        realtime: live({ id: "ably-client" }),
        invocations: [],
      })
    );

    await renderLayer(root, true);
    const prepare = (
      providers.chatTransport.at(-1)?.chatOptions as {
        prepareSendMessagesRequest: (input: Record<string, unknown>) => unknown;
      }
    ).prepareSendMessagesRequest;

    expect(() =>
      prepare({
        trigger: "submit-message",
        messages: [],
        history: [APPROVED_ASSISTANT],
      })
    ).toThrow("not linked to a durable Agent invocation");
  });

  /**
   * WHERE THE AGENT WROTE, announced once.
   *
   * The canvas reads its projections through react-query, so an agent write
   * lands as a silent re-render — the graph changes under the creator with
   * nothing to say where. This is the signal it uses to point.
   *
   * Once per write, and never on mount: a conversation opened three days later
   * must not yank the viewport to an edit nobody came looking for.
   */
  it("announces the nodes an agent write touched, exactly once", async () => {
    const onAgentWrote = vi.fn();
    const base = createBootstrap({ realtime: live({ id: "ably-client" }) });
    // The seed ALREADY names a written node — this is what reopening a
    // conversation days later looks like. Announcing it would send the viewport
    // flying to an edit nobody came looking for.
    hooks.useStoryStudioAgentBootstrap.mockReturnValue({
      ...base,
      history: { ...base.history, writtenNodeIds: ["an_old_edit"] },
    });
    await renderLayer(root, true, { onAgentWrote });
    expect(onAgentWrote).not.toHaveBeenCalled();

    // A NEW write, while the creator is watching.
    hooks.useStoryStudioAgentBootstrap.mockReturnValue({
      ...base,
      history: { ...base.history, writtenNodeIds: ["scene_two"] },
    });
    await renderLayer(root, true, { onAgentWrote });
    expect(onAgentWrote).toHaveBeenCalledWith(["scene_two"]);

    // Same write, re-rendered: still one announcement.
    await renderLayer(root, true, { onAgentWrote });
    expect(onAgentWrote).toHaveBeenCalledTimes(1);
  });

  it("resolves a continuation through the options object the transport was built from", async () => {
    // `useChat` keeps the transport it was constructed with, so the FIRST
    // options object built here is what every send in this panel session runs
    // through — including approvals for invocations that did not exist yet.
    // Reaching for `.at(-1)` instead would only ever test the freshest closure.
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({ realtime: live({ id: "ably-client" }), invocations: [] })
    );
    await renderLayer(root, true);
    const captured = providers.chatTransport[0]?.chatOptions as {
      prepareSendMessagesRequest: (input: Record<string, unknown>) => {
        body?: Record<string, unknown>;
      };
    };

    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({
        realtime: live({ id: "ably-client" }),
        invocations: [waitingInvocation()],
      })
    );
    await renderLayer(root, true);

    expect(
      captured.prepareSendMessagesRequest({
        trigger: "submit-message",
        messages: [],
        history: [APPROVED_ASSISTANT],
      }).body?.continuationOfInvocationId
    ).toBe(INVOCATION_ID);
  });

  it("keeps the transport options referentially stable across renders", async () => {
    // The provider recreates the ChatTransport whenever `chatOptions` changes
    // identity, and rebuilding it mid-turn would drop the live stream.
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({ realtime: live({ id: "ably-client" }) })
    );

    await renderLayer(root, true);
    await renderLayer(root, true);

    expect(providers.chatTransport.length).toBeGreaterThan(1);
    expect(providers.chatTransport[0]?.chatOptions).toBe(
      providers.chatTransport.at(-1)?.chatOptions
    );
  });
});

describe("StoryCanvasAssistantLayer first open", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: ReturnType<typeof createSession>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    providers.ably.length = 0;
    providers.chatTransport.length = 0;
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({ realtime: live({ id: "ably-client" }) })
    );
    hooks.useDisconnectedStoryStudioAgentSession.mockImplementation(() => createSession());
    session = createSession({ submit: vi.fn().mockResolvedValue(true) });
    hooks.useStoryStudioAgentSession.mockReturnValue(session);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("invites the first move on a brand-new project", async () => {
    await renderLayer(root, false, { firstOpen: firstOpenInputs() });

    const hero = container.querySelector('[data-testid="story-canvas-first-open"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain("Every choice rewrites the story");
    const animatedTitle = hero?.querySelector<HTMLElement>(".react-bits-glitch-text");
    expect(animatedTitle?.dataset.glitchTrigger).toBe("always");
    expect(animatedTitle?.querySelectorAll("[data-glitch-layer]")).toHaveLength(2);
    expect(animatedTitle?.style.getPropertyValue("--glitch-after-duration")).toBe("3.6s");
    expect(animatedTitle?.style.getPropertyValue("--glitch-after-shadow")).toContain(
      "rgba(229,34,39,0.55)"
    );
    expect(skillCards(container)).toHaveLength(2);
    expect(firstOpenComposer(container)).not.toBeNull();
    expect(firstOpenComposer(container)?.hasAttribute("disabled")).toBe(false);
    expect(
      container.querySelector(
        '[data-testid="story-canvas-first-open"] button[aria-label="Attach reference files"]'
      )
    ).not.toBeNull();
    expect(
      container
        .querySelector<HTMLInputElement>(
          '[data-testid="story-canvas-first-open"] input[type="file"]'
        )
        ?.accept.includes("application/pdf")
    ).toBe(true);
    expect(document.activeElement).toBe(firstOpenComposer(container));
    expect(hooks.useStoryStudioAgentBootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true })
    );
  });

  it("stays out of the way once the canvas has content", async () => {
    // The live node count leads the projection's per-chapter count, so both
    // paths out of the empty state have to close the hero.
    await renderLayer(root, false, { firstOpen: firstOpenInputs({ canvasNodeCount: 1 }) });
    expect(container.querySelector('[data-testid="story-canvas-first-open"]')).toBeNull();

    await renderLayer(root, false, {
      firstOpen: firstOpenInputs({ chapters: [chapter("chapter-1", 0, 3)] }),
    });
    expect(container.querySelector('[data-testid="story-canvas-first-open"]')).toBeNull();

    // A read-only viewer is not invited to start something they cannot start.
    await renderLayer(root, false, { firstOpen: firstOpenInputs({ canEdit: false }) });
    expect(container.querySelector('[data-testid="story-canvas-first-open"]')).toBeNull();
  });

  it("keeps the guidance and degrades only the action when the agent is unavailable", async () => {
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(
      createBootstrap({ status: "error", error: new Error("Studio Agent is unreachable.") })
    );

    await renderLayer(root, false, { firstOpen: firstOpenInputs() });

    const hero = container.querySelector('[data-testid="story-canvas-first-open"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain("Every choice rewrites the story");

    const notice = container.querySelector('[role="alert"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("FizzAgent is unavailable");
    // The reason, not just a generic apology.
    expect(notice?.textContent).toContain("Studio Agent is unreachable.");

    expect(firstOpenComposer(container)?.hasAttribute("disabled")).toBe(true);
    expect(firstOpenSend(container)?.hasAttribute("disabled")).toBe(true);
    for (const card of skillCards(container)) expect(card.hasAttribute("disabled")).toBe(true);
  });

  it("seeds an editable opening brief when a directing skill is clicked", async () => {
    await renderStateful(firstOpenInputs());

    const card = skillCards(container).find((node) =>
      node.textContent?.includes("Halftone collage")
    );
    expect(card).toBeDefined();
    await act(async () => card?.click());

    expect(container.querySelector('[data-slot="studio-agent-surface"]')).toBeNull();
    expect(container.querySelector('[data-testid="story-canvas-first-open"]')).not.toBeNull();
    expect(card?.getAttribute("aria-pressed")).toBe("true");
    const composer = firstOpenComposer(container);
    expect(composer?.value).toContain("a suitcase of old tickets and photos");
    // The premise and the art direction travel as separable text, because the
    // server no longer injects directing-skill instructions.
    expect(composer?.value).toContain("Art direction: flat paper fields");
  });

  it("sends the opening message and reveals its StoryOS transcript immediately", async () => {
    await renderStateful(firstOpenInputs());

    const composer = firstOpenComposer(container);
    expect(composer).not.toBeNull();
    await act(async () => {
      setTextareaValue(composer!, "A lighthouse remembers every ship it failed to save.");
    });
    expect(firstOpenSend(container)?.hasAttribute("disabled")).toBe(false);

    await act(async () => firstOpenSend(container)?.click());

    expect(container.querySelector('[data-slot="studio-agent-surface"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="story-canvas-first-open"]')).toBeNull();
    expect(session.submit).toHaveBeenCalledWith(
      "A lighthouse remembers every ship it failed to save.",
      "send",
      []
    );
  });

  it("restores the exact opening message when the transport refuses it", async () => {
    session.submit.mockResolvedValue(false);
    await renderStateful(firstOpenInputs());

    const composer = firstOpenComposer(container);
    await act(async () => {
      setTextareaValue(composer!, "A city where nobody can remember yesterday.");
    });
    await act(async () => firstOpenSend(container)?.click());

    expect(container.querySelector('[data-slot="studio-agent-surface"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "A city where nobody can remember yesterday."
    );
  });

  /** Mirrors the canvas: the layer is controlled, the parent owns `open`. */
  async function renderStateful(firstOpen: StoryCanvasFirstOpenInputs) {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <StoryCanvasAssistantLayer
          projectId="project-1"
          chapterId="chapter-1"
          workspaceId="workspace-1"
          open={open}
          onOpenChange={setOpen}
          firstOpen={firstOpen}
        >
          <main data-testid="story-canvas" style={{ width: "100%" }} />
        </StoryCanvasAssistantLayer>
      );
    }

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <Harness />
        </NextIntlClientProvider>
      );
    });
  }
});

describe("StoryCanvasAssistantLayer terminal turn failure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    providers.ably.length = 0;
    providers.chatTransport.length = 0;
    hooks.useStoryStudioAgentBootstrap.mockReturnValue(createBootstrap());
    hooks.useStoryStudioAgentSession.mockImplementation(() => createSession());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("states a terminal turn failure as an in-flow row of the conversation", async () => {
    offline(threadWithFailedTurn(INPUT_REJECTED));

    await renderLayer(root, true);

    // The regression this guards: the failure used to live in the timeline's
    // `empty` slot, which a thread with any content can never render.
    expect(container.textContent).toContain("Rename the opening scene.");
    expect(container.textContent).not.toContain(
      messages.storyStudio.canvas.studioAgent.timeline.empty
    );

    const notice = failureNotice(container);
    expect(notice).not.toBeNull();
    // In the message flow — inside the conversation log, not pinned beside the
    // composer and not a floating alert.
    expect(notice?.closest('[role="log"]')).not.toBeNull();
    expect(notice?.getAttribute("role")).not.toBe("alert");
    // The server's sentence, verbatim — not a localized apology.
    expect(notice?.textContent).toContain(INPUT_REJECTED.message);
    // The wire code and the rejected paths remain reachable — support still
    // needs them — but only behind the Details disclosure, never in the
    // primary text a casual creator reads.
    const details = notice?.querySelector("details");
    expect(details?.textContent).toContain("studio_agent.invalid_action_input");
    expect(details?.textContent).toContain("operations");
    expect(details?.textContent).toContain("must be array");
    const primary = notice!.cloneNode(true) as HTMLElement;
    primary.querySelector("details")?.remove();
    expect(primary.textContent).not.toContain("studio_agent.invalid_action_input");
    // Derived state only — nothing can hide it while it is the latest turn.
    expect([...notice!.querySelectorAll("button")].map((node) => node.textContent)).not.toContain(
      messages.storyStudio.canvas.studioAgent.dismissError
    );
  });

  it("keeps the composer immediately usable while the newest turn is a terminal failure", async () => {
    offline(threadWithFailedTurn(INPUT_REJECTED));

    await renderLayer(root, true);

    // The invariant: a terminal failed turn never leaves the composer disabled
    // or stuck in running mode — the creator can type and send right away.
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message FizzAgent"]'
    );
    expect(composer).not.toBeNull();
    expect(composer?.disabled).toBe(false);
    expect(
      container.querySelector('[data-slot="studio-agent-composer"]')?.hasAttribute("data-running")
    ).toBe(false);
  });

  it("distinguishes an input rejection from a write the server could not record", async () => {
    offline(threadWithFailedTurn(INPUT_REJECTED));
    await renderLayer(root, true);
    const rejected = failureNotice(container);
    expect(rejected?.getAttribute("data-failure-kind")).toBe("inputRejected");
    expect(rejected?.textContent).toContain("FizzAgent sent a request this story rejected");

    offline(threadWithFailedTurn(NOT_RECORDED));
    await renderLayer(root, true);
    const unrecorded = failureNotice(container);
    expect(unrecorded?.getAttribute("data-failure-kind")).toBe("notRecorded");
    expect(unrecorded?.textContent).toContain("The change ran but could not be recorded");
    expect(unrecorded?.textContent).toContain(NOT_RECORDED.message);
    expect(unrecorded?.textContent).not.toContain("FizzAgent sent a request this story rejected");
  });

  it("clears the failure once a later turn succeeds", async () => {
    offline(threadWithFailedTurn(INPUT_REJECTED));
    await renderLayer(root, true);
    expect(failureNotice(container)).not.toBeNull();

    offline({});
    await renderLayer(root, true);
    expect(failureNotice(container)).toBeNull();
  });

  it("re-sends the failed turn's own request as the next action", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    offline({ ...threadWithFailedTurn(INPUT_REJECTED), submit });

    await renderLayer(root, true);

    const retry = [...failureNotice(container)!.querySelectorAll("button")].find(
      (node) => node.textContent === "Send this request again"
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(submit).toHaveBeenCalledWith("Rename the opening scene.", "send", []);
  });

  it("hands back a request the server could not record instead of re-sending it", async () => {
    // The copy and the action have to agree. This failure is non-retryable by
    // the code that produced it, so "Send this request again" was advice the
    // same panel contradicted one line above it.
    const submit = vi.fn().mockResolvedValue(true);
    offline({ ...threadWithFailedTurn(NOT_RECORDED), submit });

    await renderLayer(root, true);

    const notice = failureNotice(container);
    expect(notice?.textContent).toContain("describe the change a different way");
    const labels = [...notice!.querySelectorAll("button")].map((node) => node.textContent);
    expect(labels).not.toContain("Send this request again");
    const edit = [...notice!.querySelectorAll("button")].find(
      (node) => node.textContent === "Edit this request"
    );
    expect(edit).toBeDefined();

    await act(async () => edit?.click());

    expect(submit).not.toHaveBeenCalled();
    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(composer?.value).toBe("Rename the opening scene.");
    // The caret lands where the creator has to act.
    expect(document.activeElement).toBe(composer);
  });

  it("still reports the failure while StoryOS is closed and offers the way in", async () => {
    const onOpenChange = vi.fn();
    offline(threadWithFailedTurn(NOT_RECORDED));

    await renderLayer(root, false, { onOpenChange });

    // Closed panel: one compact notice, not the failure surface itself — it
    // deep-links to the timeline row that owns the retry and the diagnostics.
    const notice = closedFailureNotice(container);
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(NOT_RECORDED.message);
    // The notice floats over the canvas region — the split never opens a
    // panel column for a closed StoryOS.
    expect(notice?.closest('[data-slot="studio-agent-canvas-region"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="studio-agent-surface"]')).toBeNull();
    // No second in-flow row can exist out here: the panel is closed.
    expect(failureNotice(container)).toBeNull();
    const open = [...notice!.querySelectorAll("button")].find(
      (node) => node.textContent === "Open FizzAgent"
    );
    expect(open).toBeDefined();
    await act(async () => open?.click());
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("retires the closed-panel notice for good once dismissed", async () => {
    offline(threadWithFailedTurn(NOT_RECORDED));

    await renderLayer(root, false);
    const notice = closedFailureNotice(container);
    expect(notice).not.toBeNull();

    const dismiss = notice!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
    expect(dismiss).not.toBeNull();
    await act(async () => dismiss?.click());
    expect(closedFailureNotice(container)).toBeNull();

    // The same failure must not come back on a later render pass; the timeline
    // row inside the panel remains its durable, discoverable home.
    await renderLayer(root, false);
    expect(closedFailureNotice(container)).toBeNull();
  });

  it("never echoes a failure the creator has already seen inside the panel", async () => {
    offline(threadWithFailedTurn(NOT_RECORDED));

    // Open: the timeline row is the single presentation — no floating notice.
    await renderLayer(root, true);
    expect(closedFailureNotice(container)).toBeNull();
    expect(failureNotice(container)).not.toBeNull();
    await act(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        })
    );

    // Closing the panel afterwards must not resurrect an echo of a row the
    // creator already read.
    await renderLayer(root, false);
    expect(closedFailureNotice(container)).toBeNull();
  });

  it("wires the load-earlier control to the session", async () => {
    const loadEarlierTurns = vi.fn().mockResolvedValue(undefined);
    offline({ hasEarlierTurns: true, loadEarlierTurns });

    await renderLayer(root, true);

    // Asserting the click, not just the prop: a type-valid mis-wire such as
    // `loading: session.submitting` renders identically.
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Load earlier turns"
    );
    expect(button).toBeDefined();
    expect(button?.hasAttribute("disabled")).toBe(false);
    await act(async () => button?.click());
    expect(loadEarlierTurns).toHaveBeenCalledTimes(1);
  });

  it("hides the load-earlier control when the window covers the whole thread", async () => {
    offline({ hasEarlierTurns: false });

    await renderLayer(root, true);

    expect(
      [...container.querySelectorAll("button")].some(
        (node) => node.textContent === "Load earlier turns"
      )
    ).toBe(false);
  });
});

function offline(overrides: Record<string, unknown>) {
  hooks.useDisconnectedStoryStudioAgentSession.mockImplementation(() => createSession(overrides));
}

const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000002";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000003";
const FAILED_RUN_ID = "00000000-0000-4000-8000-000000000052";

/** The two attributions the server keeps apart; see studio-agent.capability-error.ts. */
const INPUT_REJECTED: StudioAgentError = {
  code: "studio_agent.invalid_action_input",
  message: "The prepared capability input is invalid. operations: must be array",
  retryable: false,
  details: { issues: [{ path: "operations", message: "must be array" }] },
};
const NOT_RECORDED: StudioAgentError = {
  code: "studio_agent.capability_result_invalid",
  message:
    "The capability ran but the server could not record its result: a Studio Agent contract was violated after the action input was accepted.",
  retryable: false,
  details: null,
};

async function renderLayer(
  root: Root,
  open: boolean,
  {
    onOpenChange = vi.fn(),
    firstOpen,
    suspended = false,
    onAgentWrote,
  }: {
    onOpenChange?: (open: boolean) => void;
    firstOpen?: StoryCanvasFirstOpenInputs;
    suspended?: boolean;
    onAgentWrote?: (nodeIds: readonly string[]) => void;
  } = {}
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <StoryCanvasAssistantLayer
          projectId="project-1"
          chapterId="chapter-1"
          workspaceId="workspace-1"
          open={open}
          suspended={suspended}
          onOpenChange={onOpenChange}
          firstOpen={firstOpen}
          onAgentWrote={onAgentWrote}
        >
          <main data-testid="story-canvas" style={{ width: "100%" }} />
        </StoryCanvasAssistantLayer>
      </NextIntlClientProvider>
    );
  });
}

/** The in-flow failure row inside the panel's conversation log. */
function failureNotice(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-slot="studio-agent-turn-failure"]');
}

/** The compact dismissible echo shown on the canvas while StoryOS is closed. */
function closedFailureNotice(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-slot="studio-agent-turn-failure-notice"]');
}

function skillCards(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>("button[data-skill]")];
}

function firstOpenComposer(container: HTMLElement) {
  return container.querySelector<HTMLTextAreaElement>(
    '[data-testid="story-canvas-first-open"] textarea'
  );
}

function firstOpenSend(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="story-canvas-first-open"] button[data-action="send"]'
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function live(client: unknown) {
  return {
    client,
    channelName: `agent:v1:conversation:${THREAD_ID}`,
    status: "connected",
    error: null,
  };
}

/** A thread with real content whose newest turn died. */
function threadWithFailedTurn(error: StudioAgentError): Record<string, unknown> {
  const prompt: StudioAgentMessageView = {
    id: "message-1:0",
    messageId: "message-1",
    clientMessageId: "client-message-1",
    runId: FAILED_RUN_ID,
    role: "user",
    delivery: "send",
    format: "plain_text",
    text: "Rename the opening scene.",
    attachments: [],
    status: "completed",
    streaming: false,
    createdAt: "2026-07-28T10:00:00.000Z",
  };
  const failedRun: StudioAgentFailedRunView = {
    id: FAILED_RUN_ID,
    parentRunId: null,
    title: "",
    summary: error.message,
    error,
    status: "failed",
    progress: 1,
    createdAt: "2026-07-28T10:00:00.000Z",
    startedAt: "2026-07-28T10:00:00.000Z",
    completedAt: "2026-07-28T10:00:03.000Z",
  };
  const timeline: StudioAgentTimelineItemView[] = [
    { kind: "message", id: prompt.id, message: prompt },
    { kind: "run", id: FAILED_RUN_ID, run: failedRun },
  ];
  return { timeline, turnFailure: failedRun, runs: [failedRun] };
}

function firstOpenInputs(
  overrides: Partial<StoryCanvasFirstOpenInputs> = {}
): StoryCanvasFirstOpenInputs {
  return {
    chapters: [chapter("chapter-1", 0, 0)],
    canvasNodeCount: 0,
    canEdit: true,
    ...overrides,
  };
}

function chapter(id: string, rank: number, nodeCount: number): StoryChapter {
  return {
    id,
    projectId: "project-1",
    title: `Chapter ${rank + 1}`,
    rank,
    entryNodeId: nodeCount > 0 ? `node-${rank}` : null,
    nodeCount,
    createdByUserId: "user-1",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

/**
 * The assistant message the creator has just answered, as the PANEL holds it.
 *
 * The channel tree's copy of this same message still reads
 * `approval-requested` at the moment the continuation is prepared — publishing
 * the answer is what the continuation is FOR. Keeping the two apart in the test
 * is the whole point: read the decision from the tree and the body comes out
 * empty, which is exactly what shipped.
 */
const APPROVED_ASSISTANT = {
  id: "assistant-1",
  role: "assistant" as const,
  metadata: { threadId: THREAD_ID, runId: RUN_ID },
  parts: [
    {
      type: "dynamic-tool",
      toolName: "cap_story_canvas_delete_scene_abcabcabcabc",
      toolCallId: "call-1",
      state: "approval-responded",
      input: { sceneId: "scene-1" },
      approval: { id: "sdk-approval-1", approved: true },
    },
  ],
};

function waitingInvocation() {
  return {
    invocationId: INVOCATION_ID,
    runId: RUN_ID,
    clientMessageId: "creator-message-1",
    inputEventId: "ably-event-1",
    status: "waiting_for_approval",
    error: null,
    latestAttempt: {
      attemptId: "00000000-0000-4000-8000-000000000004",
      ordinal: 0,
      inputEventId: "ably-event-1",
      clientMessageId: "creator-message-1",
      status: "dispatched",
      error: null,
    },
    createdAt: "2026-07-30T12:00:00.000Z",
    startedAt: "2026-07-30T12:00:01.000Z",
    completedAt: null,
  };
}

function createBootstrap(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    workspaceId: "workspace-1",
    locale: "en-US",
    status: "ready",
    error: null,
    thread: { threadId: THREAD_ID, permissionPolicy: { mode: "ask" } },
    history: {
      messages: [],
      messageIds: new Set<string>(),
      nextCursor: null,
      runs: [],
      activities: [],
      writeToken: "",
      writtenNodeIds: [],
    },
    invocations: [],
    conversationKey: `${THREAD_ID}:0`,
    realtime: { client: null, channelName: null, status: "idle", error: null },
    hasEarlierTurns: false,
    loadingEarlierTurns: false,
    policyUpdating: false,
    commandError: null,
    clearCommandError: vi.fn(),
    reportCommandError: vi.fn(),
    retry: vi.fn(),
    loadEarlierTurns: vi.fn().mockResolvedValue(undefined),
    refreshHistory: vi.fn(),
    refreshInvocations: vi.fn(),
    invoke: vi.fn().mockResolvedValue({
      schemaVersion: "agent-invocation-accepted/v1",
      invocationId: RUN_ID,
    }),
    requestDurableCancel: vi.fn().mockResolvedValue(undefined),
    startNewConversation: vi.fn().mockResolvedValue(undefined),
    uploadAttachment: vi.fn(),
    updatePermissionMode: vi.fn(),
    ...overrides,
  };
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    error: null,
    streamStatus: "connected",
    streamError: null,
    commandError: null,
    // A ready session always has a resolved thread; the composer (and the
    // first-open hero) stay gated until it exists.
    thread: { permissionPolicy: { mode: "ask" } },
    timeline: [],
    childRuns: [],
    turnFailure: null,
    activeRun: null,
    canSteer: false,
    isRunning: false,
    streaming: false,
    queuedCount: 0,
    submitting: false,
    cancelling: false,
    policyUpdating: false,
    hasEarlierTurns: false,
    loadingEarlierTurns: false,
    loadEarlierTurns: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(),
    clearCommandError: vi.fn(),
    submit: vi.fn(),
    uploadAttachment: vi.fn(),
    cancelActiveRun: vi.fn(),
    updatePermissionMode: vi.fn(),
    respondToToolApproval: vi.fn(),
    canRespondToToolApproval: vi.fn().mockReturnValue(true),
    retryRejectedAttempt: vi.fn().mockResolvedValue(false),
    commandErrorRetry: null,
    startNewConversation: vi.fn(),
    ...overrides,
  };
}
