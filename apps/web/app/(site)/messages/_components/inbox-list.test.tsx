// @vitest-environment jsdom

/**
 * Crew chats share the global inbox with inquiries and orders — they
 * have to, because the nav bell sums inbox unread counts and excluding
 * crews would show a zero badge to someone with twelve unread crew
 * messages.
 *
 * Sharing the list means sharing the row, and the row was written for a
 * two-party thread. `counterpartyId` on a crew row is the CREW id (the
 * DTO says so, and it stays required so the shipped order inbox keeps
 * compiling), so the un-branched row would look that id up as a user,
 * miss, and print "User crew_1" under a stranger's generated face.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationCardDTO } from "@repo/shared/conversation";
import { InboxList } from "./inbox-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  items: [] as unknown[],
  displays: new Map<string, { userId: string; nickname: string; avatar?: string }>(),
  lookedUpIds: [] as string[][],
  contextFilter: undefined as string | undefined,
  error: null as Error | null,
  refetch: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
}));

// Real en-US copy: a key that never landed in the message files shows
// up as its own bare name and fails the assertions below.
vi.mock("@/src/i18n/i18n", async () => {
  const catalog = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    unknown
  >;
  const lookup = (node: unknown, key: string): string | undefined => {
    if (node === null || typeof node !== "object") return undefined;
    const obj = node as Record<string, unknown>;
    if (typeof obj[key] === "string") return obj[key] as string;
    const parts = key.split(".");
    for (let i = parts.length - 1; i > 0; i--) {
      const found = lookup(obj[parts.slice(0, i).join(".")], parts.slice(i).join("."));
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return {
    useTranslations:
      (ns: string) => (key: string, vars?: Record<string, string | number | undefined>) => {
        const template =
          lookup(catalog[ns], key) ?? (vars?.defaultValue as string | undefined) ?? key;
        return Object.entries(vars ?? {}).reduce<string>(
          (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
          template
        );
      },
    useLocale: () => "en-US",
  };
});

vi.mock("@/src/env", () => ({
  env: { BANNER_BASE_URL: "https://banner.test", OSS_BASE_URL: "", USER_BASE_URL: "" },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/app/(site)/creators/_hooks/use-conversations", () => ({
  useInbox: (contextType?: string) => {
    state.contextFilter = contextType;
    return {
      data: { items: state.items, hasMore: state.hasNextPage },
      isLoading: false,
      isError: !!state.error,
      error: state.error,
      hasNextPage: state.hasNextPage,
      isFetchingNextPage: state.isFetchingNextPage,
      fetchNextPage: state.fetchNextPage,
      refetch: state.refetch,
    };
  },
}));

vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: (ids: readonly string[]) => {
    state.lookedUpIds.push([...ids]);
    return state.displays;
  },
}));

vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ src, name, seed }: { src?: string | null; name?: string; seed?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- a test stub, not a rendered page
    <img data-avatar="" src={src ?? ""} alt={name ?? ""} data-seed={seed ?? ""} />
  ),
}));

function crewCard(overrides: Partial<ConversationCardDTO> = {}): ConversationCardDTO {
  return {
    id: "conv_crew",
    contextType: "crew",
    contextId: "crew_1",
    // Required fields the crew projection fills with the crew itself.
    counterpartyId: "crew_1",
    counterpartyRole: "member",
    crewId: "crew_1",
    crewName: "Night Shift",
    crewLogo: "logos/night-shift.png",
    memberCount: 12,
    lastMessagePreview: "Cut is up",
    lastMessageType: "text",
    lastMessageAt: "2026-07-27T09:00:00.000Z",
    unreadCount: 3,
    ...overrides,
  };
}

function serviceCard(): ConversationCardDTO {
  return {
    id: "conv_svc",
    contextType: "service",
    contextId: "svc_1",
    counterpartyId: "42",
    counterpartyRole: "buyer",
    lastMessagePreview: "Can you take this on?",
    lastMessageType: "text",
    lastMessageAt: "2026-07-27T08:00:00.000Z",
    unreadCount: 0,
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function text(): string {
  return document.body.textContent ?? "";
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function filterTab(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("header button")].find(
    (b) => b.textContent?.trim() === label
  );
  if (!match) throw new Error(`no filter tab "${label}"`);
  return match as HTMLButtonElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.items = [];
  state.displays = new Map();
  state.lookedUpIds = [];
  state.contextFilter = undefined;
  state.error = null;
  state.refetch = vi.fn();
  state.hasNextPage = false;
  state.isFetchingNextPage = false;
  state.fetchNextPage = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("crew rows in the inbox", () => {
  it("renders the crew's identity, not a counterparty", () => {
    state.items = [crewCard()];
    render(<InboxList activeId={null} />);

    expect(text()).toContain("Night Shift");
    expect(text()).toContain("12 members");
    expect(text()).toContain("Crew");
    // The crew id was never resolved as, or rendered as, a person.
    expect(text()).not.toContain("User crew_1");

    const avatar = document.querySelector("img[data-avatar]") as HTMLImageElement;
    expect(avatar.src).toBe("https://banner.test/logos/night-shift.png");
    expect(avatar.dataset.seed).toBe("crew:crew_1");
  });

  it("keeps the crew id out of the batched user lookup", () => {
    state.items = [crewCard(), serviceCard()];
    render(<InboxList activeId={null} />);

    expect(state.lookedUpIds.at(-1)).toEqual(["42"]);
  });

  it("still shows the crew's unread badge, which the nav bell sums", () => {
    state.items = [crewCard({ unreadCount: 3 })];
    render(<InboxList activeId={null} />);

    expect(text()).toContain("3");
  });

  it("falls back to a generic label when the server could not resolve the crew", () => {
    state.items = [crewCard({ crewName: undefined, crewLogo: undefined, memberCount: undefined })];
    render(<InboxList activeId={null} />);

    expect(text()).toContain("Crew chat");
    expect(text()).not.toContain("members");
    expect(text()).not.toContain("User crew_1");
  });

  it("localizes a crew system message in the row preview", () => {
    state.items = [
      crewCard({ lastMessagePreview: "[system:crew.member.joined]", lastMessageType: "system" }),
    ];
    render(<InboxList activeId={null} />);

    expect(text()).toContain("A member joined.");
    // Not the raw wire marker, and not the "Status updated" catch-all.
    expect(text()).not.toContain("[system:");
    expect(text()).not.toContain("Status updated");
  });

  it("offers a crews filter that narrows the request server-side", () => {
    state.items = [crewCard(), serviceCard()];
    render(<InboxList activeId={null} />);

    expect(state.contextFilter).toBeUndefined();
    click(filterTab("Crews"));
    expect(state.contextFilter).toBe("crew");
  });

  it("still renders a two-party row as a person", () => {
    state.items = [serviceCard()];
    state.displays = new Map([["42", { userId: "42", nickname: "Ada" }]]);
    render(<InboxList activeId={null} />);

    expect(text()).toContain("Ada");
    expect(text()).toContain("Inquiry");
    const avatar = document.querySelector("img[data-avatar]") as HTMLImageElement;
    expect(avatar.dataset.seed).toBe("42");
  });

  it("shows the API error and lets the reader retry instead of faking an empty inbox", () => {
    state.error = new Error("Conversation database is unavailable");
    render(<InboxList activeId={null} />);

    expect(text()).toContain("Conversation database is unavailable");
    expect(text()).not.toContain("No conversations yet");

    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Retry"
    );
    expect(retry).toBeTruthy();
    click(retry!);
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("walks through an empty cursor page and keeps Load more reachable", () => {
    state.hasNextPage = true;
    render(<InboxList activeId={null} />);

    expect(text()).toContain("Looking for more conversations");
    expect(text()).not.toContain("No conversations yet");
    const loadMore = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Load more"
    );
    expect(loadMore).toBeTruthy();
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);

    click(loadMore!);
    expect(state.fetchNextPage).toHaveBeenCalledTimes(2);
  });
});
