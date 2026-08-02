// @vitest-environment jsdom

/**
 * The chat tab is a resolver, not a chat implementation: it turns a
 * crew id into a conversation id and hands off to the shared
 * `ConversationView`. Two things about that are worth pinning.
 *
 * First, it must hand room lifecycle to `CrewChatRoom` rather than
 * reimplementing transport beside the shared timeline.
 *
 * Second, when the resolve fails the reader has to see WHY. "You are no
 * longer a member of this crew" is actionable; "群聊打不开" on its own
 * is not (doc §9, root AGENTS.md § Error reporting).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CrewChatTab } from "./crew-chat-tab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    error: null as Error | null,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/src/i18n/i18n", async () => {
  const catalog = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (ns: string) => (key: string) => catalog[ns]?.[key] ?? key,
    useLocale: () => "en-US",
  };
});

vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-conversation", () => ({
  useCrewConversation: () => state.query,
}));

vi.mock("@/app/(site)/messages/_components/conversation-view", () => ({
  ConversationView: ({ conversationId, surface }: { conversationId: string; surface?: string }) => (
    <div data-view="" data-conversation={conversationId} data-surface={surface} />
  ),
}));

vi.mock("@/src/lib/conversations/crew-chat-room", () => ({
  CrewChatRoom: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.query = {
    data: { id: "conv_1" },
    error: null,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("crew chat tab", () => {
  it("hands the resolved conversation to the shared view, embedded", () => {
    render(<CrewChatTab crewId="crew_1" />);

    const view = document.querySelector("[data-view]") as HTMLElement;
    expect(view.dataset.conversation).toBe("conv_1");
    expect(view.dataset.surface).toBe("workspace");
  });

  it("shows the server's own words when the crew chat cannot be opened", () => {
    state.query = {
      data: undefined,
      error: new Error("You are no longer a member of this crew"),
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    render(<CrewChatTab crewId="crew_1" />);

    expect(document.body.textContent).toContain("You are no longer a member of this crew");
    expect(document.querySelector("[data-view]")).toBeNull();
  });

  it("offers a retry that re-runs the resolve", () => {
    const refetch = vi.fn();
    state.query = {
      data: undefined,
      error: new Error("Crew chat is temporarily unavailable"),
      isPending: false,
      isFetching: false,
      refetch,
    };
    render(<CrewChatTab crewId="crew_1" />);

    click(button("Retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state instead of an empty pane while resolving", () => {
    state.query = {
      data: undefined,
      error: null,
      isPending: true,
      isFetching: true,
      refetch: vi.fn(),
    };
    render(<CrewChatTab crewId="crew_1" />);

    expect(document.querySelector("[data-view]")).toBeNull();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });
});
