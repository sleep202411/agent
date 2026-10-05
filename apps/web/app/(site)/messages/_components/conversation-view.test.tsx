// @vitest-environment jsdom

/**
 * One chat view now serves two very different threads, so the branches
 * that tell them apart are what these pin down.
 *
 *   - A crew thread is N-party. Its header must show the CREW — name,
 *     logo, member count — because the server hands back the crew id in
 *     `counterpartyId` and rendering that as a person produces "User
 *     crew_1" over a stranger's generated face.
 *   - Every proposal affordance has to stay off a crew thread. The
 *     gates read `contextType === "service"`, and if that clause is
 *     ever dropped a crew member could be shown an Accept button that
 *     mints an order.
 *   - A send that fails has to say why, in the server's words, and be
 *     retryable without retyping (doc §9).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConversationDTO,
  ConversationMentionPayload,
  ConversationParticipantRole,
  ConversationTaskReferencePayload,
  MessageDTO,
} from "@repo/shared/conversation";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { ConversationView } from "./conversation-view";

/** What the composer hands `useSendText`. */
type SendInput = {
  body: string;
  clientKey?: string;
  mentions?: ConversationMentionPayload[];
  tasks?: ConversationTaskReferencePayload[];
};
type SendAttachmentsInput = {
  attachments: Array<
    | { source: "asset"; assetNodeId: string }
    | { source: "upload"; mediaAssetId: string; name: string }
  >;
  body?: string;
  clientKey?: string;
  mentions?: ConversationMentionPayload[];
  tasks?: ConversationTaskReferencePayload[];
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  conversation: null as unknown,
  conversationError: null as Error | null,
  conversationIsFetching: false,
  conversationRefetch: vi.fn(
    async (): Promise<{ data: unknown; error: Error | null }> => ({
      data: null,
      error: null,
    })
  ),
  messages: [] as unknown[],
  messagesError: null as Error | null,
  messagesIsFetching: false,
  messagesRefetch: vi.fn(
    async (): Promise<{ data: unknown; error: Error | null }> => ({
      data: null,
      error: null,
    })
  ),
  crew: null as unknown,
  displays: new Map<string, { userId: string; nickname: string; avatar?: string }>(),
  sendText: {
    mutateAsync: vi.fn(async (input: SendInput) => input as unknown),
    isPending: false,
  },
  sendAttachments: {
    mutateAsync: vi.fn(async (input: SendAttachmentsInput) => input as unknown),
    isPending: false,
  },
  taskOptions: [] as Array<{
    id: string;
    number: number;
    title: string;
    status: "open" | "in_progress" | "submitted" | "revision_requested" | "approved" | "cancelled";
    priority: "low" | "normal" | "high" | "urgent";
    workflowStateId: string;
    parentId: string | null;
  }>,
  markRead: { mutate: vi.fn() },
  clearAccessCache: vi.fn(),
  discardPendingUpload: vi.fn(async (crewId: string, mediaAssetId: string) => {
    void crewId;
    void mediaAssetId;
  }),
}));

// Real en-US copy: a key that never landed in the message files shows
// up as its own bare name and fails the assertions below.
vi.mock("@/src/i18n/i18n", async () => {
  const catalog = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    unknown
  >;
  /** i18next resolves a dotted key against nested objects AND against
   *  flat keys that contain dots (`system["order.submitted"]`). Both
   *  spellings are in the catalog, so the mock has to do the same. */
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img src={src} alt={alt} />
  ),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "7" } }) }));

vi.mock("@/app/(site)/creators/_hooks/use-conversations", () => ({
  isOptimisticConversationMessage: (message: MessageDTO) => message.id.startsWith("optimistic:"),
  isConversationAccessError: (error: unknown) =>
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status: number }).status === 403 || (error as { status: number }).status === 404),
  useConversation: () => ({
    data: state.conversation,
    error: state.conversationError,
    isLoading: false,
    isFetching: state.conversationIsFetching,
    refetch: state.conversationRefetch,
  }),
  useMessages: () => ({
    data: { items: state.messages, hasMore: false },
    error: state.messagesError,
    isError: state.messagesError !== null,
    isLoading: false,
    isFetching: state.messagesIsFetching,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: state.messagesRefetch,
  }),
  useClearConversationAccessCache: () => state.clearAccessCache,
  useMarkRead: () => state.markRead,
  useSendText: () => state.sendText,
  useSendAttachments: () => state.sendAttachments,
  useDeclineProposal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/app/(site)/creators/_hooks/use-orders", () => ({
  useAcceptProposal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCrewDetail: (id: string) => ({ data: id ? state.crew : undefined }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => state.displays,
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets", () => ({
  discardPendingCrewAssetUpload: (...args: [string, string]) => state.discardPendingUpload(...args),
  useCrewAssetContext: () => ({
    data: {
      storageAvailable: true,
      maxUploadBytes: 1024 * 1024,
      capabilities: { upload: true },
    },
  }),
  useAttachCrewAssetFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrewAssets: () => ({
    data: { items: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-tasks", () => ({
  useCrewTaskOptions: () => ({
    data: state.taskOptions,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/src/lib/media-upload", () => ({
  uploadFileViaSignedUrl: vi.fn(),
}));

vi.mock("./send-proposal-dialog", () => ({ SendProposalDialog: () => null }));

// Avatars are DiceBear-backed and irrelevant here; a plain <img> keeps
// the src (which IS load-bearing — a crew logo resolves against the
// banner bucket, not the user bucket) assertable.
vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ src, name, seed }: { src?: string | null; name?: string; seed?: string }) => {
    const props = src ? { src } : {};
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a test stub, not a rendered page
      <img data-avatar="" {...props} alt={name ?? ""} data-seed={seed ?? ""} />
    );
  },
}));

function participant(
  userId: string,
  role: ConversationParticipantRole
): ConversationDTO["participants"][number] {
  return { userId, role, lastReadMessageId: null };
}

function thread(
  overrides: Partial<ConversationDTO> = {},
  roles: ConversationParticipantRole[] = ["member", "member", "member"]
): ConversationDTO {
  const contextType = overrides.contextType ?? "crew";
  return {
    id: "conv_1",
    contextType,
    crewChannel: contextType === "crew" ? "team" : null,
    contextId: "crew_1",
    participants: roles.map((role, i) => participant(String(7 + i), role)),
    lastMessage: null,
    lastMessageAt: "2026-07-27T00:00:00.000Z",
    unreadCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function proposalMessage(): MessageDTO {
  return {
    id: "m_1",
    conversationId: "conv_1",
    authorId: "8",
    type: "proposal",
    body: "Here is the offer",
    payload: {
      kind: "proposal",
      proposal: {
        status: "open",
        packageTier: "standard",
        price: 500,
        currency: "USD",
        deliveryDays: 7,
        revisions: 2,
        scope: ["Storyboard"],
        note: "",
      },
    },
    createdAt: "2026-07-27T00:00:00.000Z",
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

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

function hasButton(label: string): boolean {
  return [...document.querySelectorAll("button")].some((b) => b.textContent?.includes(label));
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function composer(): HTMLTextAreaElement {
  const el = document.querySelector("textarea");
  if (!el) throw new Error("no composer");
  return el;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  // jsdom has no layout, so the timeline's scroll-to-bottom would throw.
  Element.prototype.scrollTo = vi.fn();
  state.conversation = thread();
  state.conversationError = null;
  state.conversationIsFetching = false;
  state.conversationRefetch = vi.fn(async () => ({
    data: state.conversation,
    error: state.conversationError,
  }));
  state.messages = [];
  state.messagesError = null;
  state.messagesIsFetching = false;
  state.messagesRefetch = vi.fn(async () => ({
    data: { items: state.messages, hasMore: false },
    error: state.messagesError,
  }));
  state.crew = { id: "crew_1", name: "Night Shift", logo: "logos/night-shift.png" };
  state.displays = new Map();
  state.sendText = {
    mutateAsync: vi.fn(async (input: SendInput) => input as unknown),
    isPending: false,
  };
  state.sendAttachments = {
    mutateAsync: vi.fn(async (input: SendAttachmentsInput) => input as unknown),
    isPending: false,
  };
  state.taskOptions = [];
  state.markRead = { mutate: vi.fn() };
  state.clearAccessCache = vi.fn();
  state.discardPendingUpload = vi.fn(async (crewId: string, mediaAssetId: string) => {
    void crewId;
    void mediaAssetId;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("crew conversation identity", () => {
  it("renders the crew instead of a counterparty", () => {
    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("Night Shift");
    expect(text()).toContain("3 members");
    // The crew id must never be resolved as a user.
    expect(text()).not.toContain("User crew_1");
    expect(text()).not.toContain("User 8");

    const avatar = document.querySelector("img[data-avatar]") as HTMLImageElement;
    // Crew logos live in the banner bucket, not the user/OSS one.
    expect(avatar.src).toBe("https://banner.test/logos/night-shift.png");
    expect(avatar.alt).toBe("Night Shift");
    expect(avatar.dataset.seed).toBe("crew:crew_1");
  });

  it("falls back to a generic crew label when the crew row is unresolved", () => {
    state.crew = undefined;
    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("Crew chat");
    expect(text()).toContain("3 members");
  });

  it("names the author of each message, which a two-party thread does not need", () => {
    state.displays = new Map([["8", { userId: "8", nickname: "Ada" }]]);
    state.messages = [
      {
        id: "m_1",
        conversationId: "conv_1",
        authorId: "8",
        type: "text",
        body: "Cut is up",
        payload: null,
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];
    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("Ada");
    expect(text()).toContain("Cut is up");
  });

  it("starts a fresh avatar group when the same author returns later", () => {
    state.displays = new Map([["7", { userId: "7", nickname: "Isaac" }]]);
    state.messages = [
      {
        id: "m_early",
        conversationId: "conv_1",
        authorId: "7",
        type: "text",
        body: "Morning update",
        payload: null,
        createdAt: "2026-07-27T14:09:00.000Z",
      },
      {
        id: "m_same_burst",
        conversationId: "conv_1",
        authorId: "7",
        type: "text",
        body: "One minute later",
        payload: null,
        createdAt: "2026-07-27T14:10:00.000Z",
      },
      {
        id: "m_later",
        conversationId: "conv_1",
        authorId: "7",
        type: "text",
        body: "Afternoon update",
        payload: null,
        createdAt: "2026-07-27T15:38:00.000Z",
      },
    ] satisfies MessageDTO[];

    render(<ConversationView conversationId="conv_1" />);

    // The two close messages share one identity block; the later message
    // starts another and gets its own avatar/name instead of only a time.
    expect(document.querySelectorAll('img[data-avatar][alt="Isaac"]')).toHaveLength(2);
  });

  it("shows the complete revision instructions in the order conversation", () => {
    state.conversation = thread({ contextType: "order", contextId: "order_1" }, [
      "buyer",
      "creator",
    ]);
    const reason =
      "Keep the opening shot.\n" +
      "Adjust the lighting. ".repeat(50) +
      "<script>do not execute</script>";
    state.messages = [
      {
        id: "revision_1",
        conversationId: "conv_1",
        authorId: null,
        type: "system",
        body: "",
        payload: {
          kind: "system",
          system: { kind: "order.revision_requested", params: { orderId: "order_1", reason } },
        },
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];
    render(<ConversationView conversationId="conv_1" />);
    expect(text()).toContain("Buyer requested a revision.");
    expect(text()).toContain(reason);
    expect(document.querySelector("script")).toBeNull();
  });

  it("renders a crew system message with the member's name, not their id", () => {
    state.displays = new Map([["9", { userId: "9", nickname: "Bo" }]]);
    state.messages = [
      {
        id: "m_2",
        conversationId: "conv_1",
        authorId: null,
        type: "system",
        body: "",
        payload: {
          kind: "system",
          system: {
            kind: "crew.member.joined",
            params: { userId: "9" },
          },
        },
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];
    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("Bo joined the crew.");
    // No un-interpolated placeholder survived to the screen.
    expect(text()).not.toContain("{user}");
  });

  it("renders a task reference as inline linked text without a task card", () => {
    state.messages = [
      {
        id: "m_task",
        conversationId: "conv_1",
        authorId: "8",
        type: "text",
        body: "Please review #TASK-12 SC.010 storyboard",
        payload: {
          kind: "text",
          tasks: [
            {
              taskId: "task_1",
              crewId: "crew_1",
              number: 12,
              label: "TASK-12 SC.010 storyboard",
            },
          ],
        },
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];

    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("#TASK-12 SC.010 storyboard");
    expect(text()).not.toContain("In review");
    expect(text()).not.toContain("assignees");
    expect(document.querySelector('a[href*="tab=tasks"][href*="task=task_1"]')).not.toBeNull();
  });

  it("renders durable crew attachments without exposing a storage key", () => {
    state.messages = [
      {
        id: "m_file",
        conversationId: "conv_1",
        authorId: "8",
        type: "file",
        body: "",
        payload: {
          kind: "attachments",
          attachments: [
            {
              assetNodeId: "asset_1",
              mediaAssetId: "media_1",
              name: "animatic.mp4",
              mediaKind: "video",
              contentType: "video/mp4",
              sizeBytes: 1048576,
            },
          ],
        },
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];

    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("animatic.mp4");
    expect(text()).toContain("1.0 MB");
    const link = document.querySelector('a[href*="/media/assets/media_1/content"]');
    expect(link).not.toBeNull();
    expect(document.querySelector('video[aria-label="animatic.mp4"]')).not.toBeNull();
    expect(document.body.innerHTML).not.toContain("storageKey");
    expect(text()).toContain("Saved to crew assets");

    click(link as HTMLElement);
    expect(document.querySelector('a[href*="tab=assets"][href*="asset=asset_1"]')).not.toBeNull();
  });

  it("renders image thumbnails and a typed file card for non-previewable attachments", () => {
    state.messages = [
      {
        id: "m_attachments",
        conversationId: "conv_1",
        authorId: "8",
        type: "file",
        body: "References",
        payload: {
          kind: "attachments",
          attachments: [
            {
              assetNodeId: "asset_image",
              mediaAssetId: "media_image",
              name: "lighting-reference.png",
              mediaKind: "image",
              contentType: "image/png",
              sizeBytes: 2048,
            },
            {
              assetNodeId: "asset_document",
              mediaAssetId: "media_document",
              name: "shooting-schedule.pdf",
              mediaKind: "document",
              contentType: "application/pdf",
              sizeBytes: 4096,
            },
          ],
        },
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];

    render(<ConversationView conversationId="conv_1" />);

    const image = document.querySelector<HTMLImageElement>('img[alt="lighting-reference.png"]');
    expect(image?.getAttribute("src")).toContain("/media/assets/media_image/content");
    expect(document.querySelector('video[aria-label="shooting-schedule.pdf"]')).toBeNull();
    expect(text()).toContain("shooting-schedule.pdf");
    expect(text()).toContain("Document");
    expect(text()).toContain("pdf");
  });

  it("drops the back-to-inbox arrow and the crew link when embedded in the workspace", () => {
    render(<ConversationView conversationId="conv_1" surface="workspace" />);
    expect(document.querySelector('a[href*="/messages"]')).toBeNull();
    expect(document.querySelector('a[href*="/workspace"]')).toBeNull();

    act(() => root!.render(<ConversationView conversationId="conv_1" />));
    expect(document.querySelector('a[href*="/messages"]')).not.toBeNull();
    expect(document.querySelector('a[href*="/workspace"]')).not.toBeNull();
  });
});

describe("proposals stay out of a crew chat", () => {
  it("offers no proposal composer to a crew participant", () => {
    render(<ConversationView conversationId="conv_1" />);
    expect(hasButton("Send proposal")).toBe(false);
  });

  it("still refuses the accept/decline actions when the viewer holds a service role", () => {
    // A deliberately hostile fixture: crew participants are `member`,
    // so `myRole === "buyer"` alone would never fire here. Handing the
    // viewer `buyer` isolates the OTHER half of the gate — the
    // `contextType === "service"` clause — and fails loudly if someone
    // ever simplifies it away.
    state.conversation = thread({}, ["buyer", "creator", "member"]);
    state.messages = [proposalMessage()];
    render(<ConversationView conversationId="conv_1" />);

    // The card itself renders read-only…
    expect(text()).toContain("Proposal");
    // …with no way to act on it, and no way to send another.
    expect(hasButton("Accept")).toBe(false);
    expect(hasButton("Decline")).toBe(false);
    expect(hasButton("Send proposal")).toBe(false);
  });

  it("still offers the proposal composer on a real service inquiry", () => {
    // The guard above is worthless if the gate is closed for everyone.
    // Viewer is user 7, so the first role in the list is theirs.
    state.conversation = thread({ contextType: "service", contextId: "svc_1" }, [
      "creator",
      "buyer",
    ]);
    render(<ConversationView conversationId="conv_1" />);

    expect(hasButton("Send proposal")).toBe(true);
  });
});

describe("read cursor visibility", () => {
  it("does not clear unread in an unfocused window, then advances on focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    state.messages = [
      {
        id: "m_unread",
        conversationId: "conv_1",
        authorId: "8",
        type: "text",
        body: "Please review",
        payload: null,
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];

    render(<ConversationView conversationId="conv_1" />);
    expect(state.markRead.mutate).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event("focus")));
    expect(state.markRead.mutate).toHaveBeenCalledWith(
      { lastReadMessageId: "m_unread" },
      expect.objectContaining({ onError: expect.any(Function) })
    );
  });

  it("waits for authoritative REST order before advancing a reversed realtime tail", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const tiedAt = "2026-07-27T00:00:00.000Z";
    const older = {
      id: "m_b",
      conversationId: "conv_1",
      authorId: "8",
      type: "text",
      body: "Older",
      payload: null,
      createdAt: tiedAt,
    } satisfies MessageDTO;
    const newer = {
      ...older,
      id: "m_c",
      body: "Newer",
    } satisfies MessageDTO;
    // A transient reversed-frame cache has the wrong tail. The
    // recovery coordinator is still fetching, so it is not safe to
    // advance the server cursor from this view.
    state.messages = [newer, older];
    state.messagesIsFetching = true;
    render(<ConversationView conversationId="conv_1" />);

    expect(state.markRead.mutate).not.toHaveBeenCalled();

    // REST settles in authoritative chronological order.
    state.messages = [older, newer];
    state.messagesIsFetching = false;
    act(() => root!.render(<ConversationView conversationId="conv_1" />));

    expect(state.markRead.mutate).toHaveBeenCalledWith(
      { lastReadMessageId: "m_c" },
      expect.objectContaining({ onError: expect.any(Function) })
    );
  });

  it("does not advance a buffered tail when authoritative recovery failed", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    state.messages = [
      {
        id: "m_buffered",
        conversationId: "conv_1",
        authorId: "8",
        type: "text",
        body: "Arrived while reconnecting",
        payload: null,
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];
    // A generic network failure keeps stale rows visible with a retry
    // affordance, but their tail order is not authoritative.
    state.messagesError = new Error("Recovery failed");

    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("Arrived while reconnecting");
    expect(text()).toContain("Recovery failed");
    expect(state.markRead.mutate).not.toHaveBeenCalled();
  });
});

describe("access revocation", () => {
  it("blocks stale history and composer after an offline member returns to a 404", async () => {
    state.messages = [
      {
        id: "private-message",
        conversationId: "conv_1",
        authorId: "8",
        type: "text",
        body: "Private production notes",
        payload: null,
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];
    state.messagesError = Object.assign(new Error("You are no longer a member of this crew"), {
      status: 404,
    });

    render(<ConversationView conversationId="conv_1" />);
    await settle();

    expect(text()).toContain("Conversation unavailable");
    expect(text()).toContain("You are no longer a member of this crew");
    expect(text()).not.toContain("Private production notes");
    expect(document.querySelector("textarea")).toBeNull();
    expect(state.markRead.mutate).not.toHaveBeenCalled();
    expect(state.clearAccessCache).toHaveBeenCalledWith("conv_1");
  });
});

describe("send states", () => {
  it("keeps a fresh upload pending until send and submits it for atomic asset promotion", async () => {
    vi.mocked(uploadFileViaSignedUrl).mockResolvedValue({
      mediaAssetId: "01910d50-4c88-7c78-92d4-16892c06a011",
      storageKey: "private/not-sent-to-message",
      url: "/aurora/media/assets/01910d50-4c88-7c78-92d4-16892c06a011/content",
    });
    render(<ConversationView conversationId="conv_1" />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["png"], "concept.png", { type: "image/png" });

    Object.defineProperty(input!, "files", { configurable: true, value: [file] });
    act(() => input!.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();

    expect(text()).not.toContain("concept.png");
    const preview = document.querySelector<HTMLImageElement>('img[alt="concept.png"]');
    expect(preview?.getAttribute("src")).toMatch(/^blob:/);
    click(button("Send"));
    await settle();

    expect(state.sendAttachments.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            source: "upload",
            mediaAssetId: "01910d50-4c88-7c78-92d4-16892c06a011",
            name: "concept.png",
          },
        ],
      })
    );
  });

  it("reclaims a pending upload when it is removed before send", async () => {
    vi.mocked(uploadFileViaSignedUrl).mockResolvedValue({
      mediaAssetId: "01910d50-4c88-7c78-92d4-16892c06a012",
      storageKey: "private/pending",
      url: "/aurora/media/assets/01910d50-4c88-7c78-92d4-16892c06a012/content",
    });
    render(<ConversationView conversationId="conv_1" />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["png"], "unused.png", { type: "image/png" });

    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    const remove = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove unused.png"]'
    );
    expect(remove).not.toBeNull();
    click(remove!);
    await settle();

    expect(state.discardPendingUpload).toHaveBeenCalledWith(
      "crew_1",
      "01910d50-4c88-7c78-92d4-16892c06a012"
    );
    expect(state.sendAttachments.mutateAsync).not.toHaveBeenCalled();
  });

  it("reclaims a pending upload when the composer leaves the page", async () => {
    vi.mocked(uploadFileViaSignedUrl).mockResolvedValue({
      mediaAssetId: "01910d50-4c88-7c78-92d4-16892c06a013",
      storageKey: "private/abandoned",
      url: "/aurora/media/assets/01910d50-4c88-7c78-92d4-16892c06a013/content",
    });
    render(<ConversationView conversationId="conv_1" />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["png"], "abandoned.png", { type: "image/png" });

    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    act(() => root?.unmount());
    root = null;
    await settle();

    expect(state.discardPendingUpload).toHaveBeenCalledWith(
      "crew_1",
      "01910d50-4c88-7c78-92d4-16892c06a013"
    );
  });

  it("sends an @mention as a structured live-member reference", async () => {
    state.displays = new Map([["8", { userId: "8", nickname: "Ada" }]]);
    render(<ConversationView conversationId="conv_1" />);

    const mentionButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Mention crew members"]'
    );
    expect(mentionButton).not.toBeNull();
    click(mentionButton!);
    click(button("Ada"));
    type(composer(), `${composer().value}please review`);
    click(button("Send"));
    await settle();

    expect(state.sendText.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "@Ada please review",
        mentions: [{ userId: "8", label: "Ada" }],
      })
    );
  });

  it("uses # to insert and send an inline durable task reference", async () => {
    state.taskOptions = [
      {
        id: "01910d50-4c88-7c78-92d4-16892c06a011",
        number: 12,
        title: "SC.010 storyboard",
        status: "in_progress",
        priority: "high",
        workflowStateId: "state-1",
        parentId: null,
      },
    ];
    render(<ConversationView conversationId="conv_1" />);

    expect(hasButton("Share task")).toBe(false);
    type(composer(), "#");
    expect(hasButton("SC.010 storyboard")).toBe(true);
    click(button("SC.010 storyboard"));
    expect(composer().value).toBe("#TASK-12 SC.010 storyboard ");
    type(composer(), `${composer().value}please review`);
    click(button("Send"));
    await settle();

    expect(state.sendText.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "#TASK-12 SC.010 storyboard please review",
        tasks: [
          {
            taskId: "01910d50-4c88-7c78-92d4-16892c06a011",
            crewId: "crew_1",
            number: 12,
            label: "TASK-12 SC.010 storyboard",
          },
        ],
      })
    );
  });

  it("never offers the current user as an @mention target", () => {
    state.displays = new Map([
      ["7", { userId: "7", nickname: "Isaac" }],
      ["8", { userId: "8", nickname: "Ada" }],
    ]);
    render(<ConversationView conversationId="conv_1" />);

    const mentionButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Mention crew members"]'
    );
    expect(mentionButton).not.toBeNull();
    click(mentionButton!);

    expect(hasButton("Ada")).toBe(true);
    expect(hasButton("Isaac")).toBe(false);
  });

  it("hides the @mention action when the current user is the only member", () => {
    state.conversation = thread({}, ["member"]);
    render(<ConversationView conversationId="conv_1" />);

    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Mention crew members"]')
    ).toBeNull();
  });

  it("shows the server's own words on a failed send and lets the reader retry", async () => {
    state.sendText.mutateAsync = vi.fn(async (input: SendInput) => {
      void input;
      throw new Error("You are no longer a member of this crew");
    });
    render(<ConversationView conversationId="conv_1" />);

    type(composer(), "Uploading the cut now");
    click(button("Send"));
    await settle();

    expect(text()).toContain("You are no longer a member of this crew");
    // Not swallowed into the generic fallback…
    expect(text()).not.toContain("Failed to send. Try again.");
    // …and the draft survives, so retrying costs no typing.
    expect(composer().value).toBe("Uploading the cut now");

    state.sendText.mutateAsync = vi.fn(async (input: SendInput) => input as unknown);
    click(button("Retry"));
    await settle();

    expect(state.sendText.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Uploading the cut now" })
    );
    expect(text()).not.toContain("You are no longer a member of this crew");
    expect(composer().value).toBe("");
    expect(text()).toContain("Sent");
  });

  it("retries under the same idempotency key, and re-keys an edited draft", async () => {
    // Doc §10 R1: 发送幂等. A retry after a timeout must not append a
    // second copy of a message every crew member then sees — so the
    // resend carries the key the first attempt used. An EDITED draft is
    // a different message, and reusing the key there would make the
    // server hand back the old row instead of sending the new text.
    const calls: SendInput[] = [];
    state.sendText.mutateAsync = vi.fn(async (input: SendInput) => {
      calls.push(input);
      throw new Error("Network unreachable");
    });
    render(<ConversationView conversationId="conv_1" />);

    type(composer(), "Cut is up");
    click(button("Send"));
    await settle();
    click(button("Retry"));
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[0].clientKey).toBeTruthy();
    expect(calls[1].clientKey).toBe(calls[0].clientKey);

    type(composer(), "Cut is up (v2)");
    click(button("Send"));
    await settle();

    expect(calls).toHaveLength(3);
    expect(calls[2].body).toBe("Cut is up (v2)");
    expect(calls[2].clientKey).not.toBe(calls[0].clientKey);
  });

  it("announces the send in flight", () => {
    state.sendText = {
      mutateAsync: vi.fn(async (input: SendInput) => input as unknown),
      isPending: true,
    };
    render(<ConversationView conversationId="conv_1" />);

    const live = document.querySelector('[role="status"]');
    expect(live?.textContent).toBe("Sending…");
  });

  it("does not erase a new draft typed while the previous send is in flight", async () => {
    let resolveSend!: (value: unknown) => void;
    state.sendText.mutateAsync = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    render(<ConversationView conversationId="conv_1" />);

    type(composer(), "First message");
    click(button("Send"));
    // Sending a plain message frees the composer synchronously; the reader
    // can continue typing while persistence completes in the background.
    expect(composer().value).toBe("");
    type(composer(), "Next message");
    await act(async () => {
      resolveSend({});
      await Promise.resolve();
    });

    expect(composer().value).toBe("Next message");
  });

  it("marks an optimistic timeline row as sending", () => {
    state.displays = new Map([["7", { userId: "7", nickname: "Isaac" }]]);
    state.messages = [
      {
        id: "optimistic:send-1",
        conversationId: "conv_1",
        authorId: "7",
        clientKey: "send-1",
        type: "text",
        body: "Instant local message",
        payload: null,
        createdAt: "2026-07-27T00:00:00.000Z",
      } satisfies MessageDTO,
    ];
    render(<ConversationView conversationId="conv_1" />);

    expect(text()).toContain("Instant local message");
    expect(document.querySelector('[role="status"][aria-label="Sending…"]')).not.toBeNull();
  });

  it("does not send when Enter is confirming an IME composition", async () => {
    render(<ConversationView conversationId="conv_1" />);
    type(composer(), "分镜已完成");

    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingEnter, "isComposing", { value: true });
    act(() => composer().dispatchEvent(composingEnter));
    expect(state.sendText.mutateAsync).not.toHaveBeenCalled();

    act(() =>
      composer().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    );
    await settle();
    expect(state.sendText.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
