import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeConversation } from "./native-conversation";
import type { NativeConversation as Detail, NativeMessage } from "./conversation-api";
const h = vi.hoisted(() => ({
  generation: 1,
  outboxRead: vi.fn(),
  outboxClear: vi.fn(),
  outboxSave: vi.fn(),
  active: true,
  focused: true,
  send: vi.fn(),
  attach: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
  older: vi.fn(),
  push: vi.fn(),
  detail: undefined as Detail | undefined,
  messages: [] as NativeMessage[],
  viewCallbacks: [] as unknown[],
  view: undefined as undefined | ((args: unknown) => void),
}));
vi.mock("@/features/crew-assets/organization", () => ({
  AssetOrganization: ({ crewId, initialNodeId }: { crewId: string; initialNodeId: string }) => (
    <div>
      asset-detail:{crewId}:{initialNodeId}
    </div>
  ),
}));
vi.mock("./conversation-outbox", () => ({
  conversationOutbox: () => ({ read: h.outboxRead, save: h.outboxSave, clear: h.outboxClear }),
}));
vi.mock("@/features/crew-assets/asset-picker", () => ({
  CrewAssetPicker: ({ onSelect }: { onSelect: (assets: unknown[]) => void }) => (
    <button onClick={() => onSelect([{ id: "asset", name: "Scene.mp4" }])}>pick-file</button>
  ),
}));
vi.mock("./conversation-attachments", () => ({
  canAttachCrewFiles: (c: Detail) => c.contextType === "crew" && c.crewChannel === "team",
  sendConversationAttachments: h.attach,
}));
vi.mock("./conversation-file", () => ({
  ConversationFile: ({ name }: { name: string }) => <div>file:{name}</div>,
}));
vi.mock("@/features/crew-assets/upload", () => ({
  pickAndUploadCrewFile: h.upload,
  discardCrewUpload: h.discard,
}));
vi.mock("./task-detail", () => ({
  TaskDetail: ({
    taskId,
    onClose,
    onOpenWeb,
  }: {
    taskId: string;
    onClose: () => void;
    onOpenWeb: (taskId: string) => void;
  }) => (
    <div>
      task-detail:{taskId}
      <button onClick={onClose}>close-detail</button>
      <button onClick={() => onOpenWeb(taskId)}>open-task-web</button>
    </div>
  ),
}));
vi.mock("./task-options", () => ({
  taskLabel: (task: { number: number; title: string }) => `TASK-${task.number} ${task.title}`,
}));
vi.mock("./task-picker", () => ({
  TaskPicker: ({ onSelect }: { onSelect: (task: unknown) => void }) => (
    <button onClick={() => onSelect({ id: "task", number: 7, title: "Scene" })}>pick-task</button>
  ),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useRouter: () => ({ push: h.push }),
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./use-inbox-realtime", () => ({ useInboxRealtime: () => false }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => new Map() }));
vi.mock("./inquiry-api", () => ({ inquiryKey: () => "stable-key" }));
vi.mock("./conversation-api", () => ({
  sendConversationText: h.send,
  markConversationRead: h.read,
}));
vi.mock("./conversation-proposal-ui", () => ({
  ConversationProposal: () => <div>proposal-card</div>,
  ConversationProposalEditor: () => null,
}));
vi.mock("./use-conversation-history", () => ({
  useConversationHistory: () => ({
    detail: h.active ? h.detail : undefined,
    messages: h.active ? h.messages : [],
    refresh: h.refresh,
    retry: h.retry,
    loadOlder: h.older,
    hasMore: false,
    loading: false,
  }),
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActivityIndicator: () => null,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
  }) => (
    <input
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  FlatList: ({
    data,
    renderItem,
    onViewableItemsChanged,
    ListFooterComponent,
  }: {
    data: NativeMessage[];
    renderItem: (args: { item: NativeMessage }) => ReactNode;
    onViewableItemsChanged: typeof h.view;
    ListFooterComponent: ReactNode;
  }) => {
    h.viewCallbacks.push(onViewableItemsChanged);
    h.view = (args) => {
      const value = args as {
        viewableItems: { item: NativeMessage; index: number; isViewable: boolean }[];
      };
      onViewableItemsChanged?.({
        viewableItems: value.viewableItems.map((token) => ({
          ...token,
          item: data.find((item) => item.id === token.item.id) ?? token.item,
        })),
      });
    };
    return (
      <div>
        {data.map((item) => (
          <div key={item.id}>{renderItem({ item })}</div>
        ))}
        {ListFooterComponent}
      </div>
    );
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const detail: Detail = {
  id: "chat",
  contextId: "service",
  contextType: "service",
  participants: [{ userId: "buyer", role: "buyer", lastReadMessageId: null }],
  createdAt: "now",
  lastMessageAt: "now",
  lastMessage: null,
  unreadCount: 1,
};
const message: NativeMessage = {
  id: "message",
  conversationId: "chat",
  authorId: "creator",
  type: "text",
  body: "Hello buyer",
  payload: null,
  createdAt: "2026-09-29T00:00:00Z",
};
const render = () =>
  act(async () =>
    root.render(
      <NativeConversation key={h.generation} id="chat" userId="buyer" generation={h.generation} />
    )
  );
const click = (text: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === text)!
    .click();
const type = (text: string) => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.outboxRead.mockReturnValue(null);
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.viewCallbacks.length = 0;
  h.detail = detail;
  h.messages = [message];
  h.discard.mockResolvedValue(undefined);
  h.read.mockResolvedValue({ lastReadMessageId: "message" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("marks only a visible message read and aborts on backgrounding", async () => {
  await render();
  expect(h.read).not.toHaveBeenCalled();
  await act(async () =>
    h.view!({ viewableItems: [{ item: message, index: 0, isViewable: true }] })
  );
  expect(h.read).toHaveBeenCalledExactlyOnceWith("chat", "message", expect.any(AbortSignal));
  const signal = h.read.mock.calls[0][2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Hello buyer");
});
it("retains failed sends and retries the same immutable request", async () => {
  h.send.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce(message);
  await render();
  await act(async () => type(" A note "));
  await act(async () => click("thread.send"));
  expect(host.textContent).toContain("Network unavailable");
  expect(host.querySelector("input")!.disabled).toBe(true);
  await act(async () => click("inbox.retry"));
  expect(h.send.mock.calls).toEqual([
    ["chat", { body: "A note", clientKey: "stable-key" }],
    ["chat", { body: "A note", clientKey: "stable-key" }],
  ]);
  expect(host.querySelector("input")!.value).toBe("");
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("suppresses rapid sends and stale-account completions", async () => {
  let resolve!: (value: NativeMessage) => void;
  h.send.mockImplementation(
    () =>
      new Promise<NativeMessage>((done) => {
        resolve = done;
      })
  );
  await render();
  await act(async () => type("Private"));
  await act(async () => {
    click("thread.send");
    click("thread.send");
  });
  expect(h.send).toHaveBeenCalledTimes(1);
  h.generation = 2;
  await render();
  await act(async () => resolve(message));
  expect(host.querySelector("input")!.value).toBe("");
  expect(h.refresh).not.toHaveBeenCalled();
});
it("preserves Crew continuation and native service/order links", async () => {
  await render();
  await act(async () => click("thread.openService"));
  expect(h.push).toHaveBeenCalledWith("/service/service");
  h.detail = { ...detail, contextType: "order", contextId: "order" };
  await render();
  await act(async () => click("thread.openOrder"));
  expect(h.push).toHaveBeenCalledWith("/order/order");
  h.detail = { ...detail, contextType: "crew" };
  await render();
  expect(host.textContent).toContain("web:/messages/chat");
  expect(host.querySelector("input")).toBeNull();
});

it("sends selected team files with an immutable retry key and keeps Web tools available", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  h.attach.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(message);
  await render();
  await act(async () => click("crewAssets.choose"));
  await act(async () => click("pick-file"));
  expect(host.textContent).toContain("Scene.mp4");
  await act(async () => click("thread.send"));
  expect(h.send).not.toHaveBeenCalled();
  expect(h.attach.mock.calls[0][2]).toEqual({
    body: "",
    clientKey: "stable-key",
    attachments: [{ source: "asset", assetNodeId: "asset" }],
  });
  await act(async () => click("inbox.retry"));
  expect(h.attach.mock.calls[1][2]).toEqual(h.attach.mock.calls[0][2]);
  expect(host.textContent).not.toContain("Scene.mp4");
  await act(async () => click("thread.openWebChat"));
  expect(host.textContent).toContain("web:/messages/chat");
  await act(async () => click("thread.backToChat"));
  expect(host.querySelector("input")).not.toBeNull();
});
it("renders received file links and keeps unknown Crew channels on Web", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team" };
  h.messages = [
    {
      ...message,
      type: "file",
      payload: {
        kind: "attachments",
        attachments: [
          {
            assetNodeId: "asset",
            mediaAssetId: "media",
            name: "Clip",
            mediaKind: "video",
            contentType: "video/mp4",
            sizeBytes: 10,
          },
        ],
      },
    },
  ];
  await render();
  expect(host.textContent).toContain("file:Clip");
  h.detail = { ...h.detail, crewChannel: null };
  await render();
  expect(host.textContent).toContain("web:/messages/chat");
  expect(host.textContent).not.toContain("crewAssets.choose");
});

it("uploads a file then retries the same attachment without uploading again", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  h.upload.mockResolvedValue({ source: "upload", mediaAssetId: "media", name: "New.mp4" });
  h.attach.mockRejectedValueOnce(new Error("uncertain")).mockResolvedValueOnce(message);
  await render();
  await act(async () => click("thread.uploadFile"));
  expect(host.textContent).toContain("New.mp4");
  await act(async () => click("thread.send"));
  expect(h.attach.mock.calls[0][2].attachments).toEqual([
    { source: "upload", mediaAssetId: "media", name: "New.mp4" },
  ]);
  await act(async () => click("inbox.retry"));
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.attach.mock.calls[1][2]).toEqual(h.attach.mock.calls[0][2]);
  expect(h.discard).not.toHaveBeenCalled();
});
it("discards an unsent removed upload but never cleans up an uncertain send", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  h.upload.mockResolvedValue({ source: "upload", mediaAssetId: "media", name: "New.mp4" });
  await render();
  await act(async () => click("thread.uploadFile"));
  await act(async () => click("New.mp4 · crewAssets.remove"));
  expect(h.discard).toHaveBeenCalledWith("crew", "media");
  h.discard.mockClear();
  await act(async () => click("thread.uploadFile"));
  h.attach.mockRejectedValue(new Error("uncertain"));
  await act(async () => click("thread.send"));
  await act(async () => root.render(<div />));
  expect(h.discard).not.toHaveBeenCalled();
});
it("suppresses duplicate uploads and ignores an upload completed after account change", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  let finish!: (v: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => {
    click("thread.uploadFile");
    click("thread.uploadFile");
  });
  expect(h.upload).toHaveBeenCalledTimes(1);
  const signal = h.upload.mock.calls[0][1];
  h.generation++;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ source: "upload", mediaAssetId: "media", name: "Old.mp4" }));
  expect(host.textContent).not.toContain("Old.mp4");
  expect(h.discard).not.toHaveBeenCalled();
});
it("sends explicit team mentions and retains them across an uncertain retry", async () => {
  h.detail = {
    ...detail,
    contextType: "crew",
    crewChannel: "team",
    participants: [
      ...detail.participants,
      { userId: "colleague", role: "member", lastReadMessageId: null },
    ],
  };
  h.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(message);
  await render();
  await act(async () => click("thread.mention"));
  expect(host.textContent).not.toContain("@buyer");
  await act(async () => click("@colleague"));
  await act(async () => click("thread.send"));
  expect(h.send.mock.calls[0][1].mentions).toEqual([{ userId: "colleague", label: "colleague" }]);
  await act(async () => click("inbox.retry"));
  expect(h.send.mock.calls[1][1]).toEqual(h.send.mock.calls[0][1]);
});
it("drops deleted mention tokens and never enables the picker for service chats", async () => {
  await render();
  expect(host.textContent).not.toContain("thread.mention");
  h.detail = {
    ...detail,
    contextType: "crew",
    crewChannel: "team",
    participants: [
      ...detail.participants,
      { userId: "colleague", role: "member", lastReadMessageId: null },
    ],
  };
  h.send.mockResolvedValue(message);
  await render();
  await act(async () => click("thread.mention"));
  await act(async () => click("@colleague"));
  await act(async () => type("plain text"));
  await act(async () => click("thread.send"));
  expect(h.send.mock.calls[0][1]).not.toHaveProperty("mentions");
});

it("sends task references with immutable retry metadata and removes deleted tokens", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team" };
  h.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(message);
  await render();
  await act(async () => click("thread.tagTask"));
  await act(async () => click("pick-task"));
  await act(async () => click("thread.send"));
  expect(h.send.mock.calls[0][1].tasks).toEqual([{ taskId: "task", label: "TASK-7 Scene" }]);
  await act(async () => click("inbox.retry"));
  expect(h.send.mock.calls[1][1]).toEqual(h.send.mock.calls[0][1]);
  await act(async () => click("thread.tagTask"));
  await act(async () => click("pick-task"));
  await act(async () => type("no reference"));
  await act(async () => click("thread.send"));
  expect(h.send.mock.calls[2][1]).not.toHaveProperty("tasks");
});
it("opens same-Crew task details natively with explicit workspace continuation", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  h.messages = [
    {
      ...message,
      payload: {
        kind: "text",
        tasks: [
          { taskId: "task", crewId: "crew", number: 7, label: "TASK-7 Scene" },
          { taskId: "foreign", crewId: "other", number: 1, label: "Foreign" },
        ],
      },
    },
  ];
  await render();
  await act(async () => click("#TASK-7 Scene"));
  expect(host.textContent).toContain("task-detail:task");
  expect(host.textContent).not.toContain("web:");
  await act(async () => click("open-task-web"));
  expect(host.textContent).toContain("web:/crews/crew/workspace?tab=tasks&task=task");
  await act(async () => click("thread.backToChat"));
  expect(host.textContent).not.toContain("#Foreign");
});

it("supports native community text and visible-message reads without team tools", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "community", contextId: "crew" };
  h.send.mockResolvedValue(message);
  await render();
  expect(host.textContent).toContain("thread.communityChat");
  expect(host.textContent).toContain("Hello buyer");
  expect(host.textContent).not.toContain("web:");
  for (const tool of ["crewAssets.choose", "thread.uploadFile", "thread.mention", "thread.tagTask"])
    expect(host.textContent).not.toContain(tool);
  expect(h.read).not.toHaveBeenCalled();
  await act(async () =>
    h.view!({ viewableItems: [{ item: message, index: 0, isViewable: true }] })
  );
  expect(h.read).toHaveBeenCalledExactlyOnceWith("chat", "message", expect.any(AbortSignal));
  await act(async () => type("Community reply"));
  await act(async () => click("thread.send"));
  expect(h.send).toHaveBeenCalledExactlyOnceWith("chat", {
    body: "Community reply",
    clientKey: "stable-key",
  });
  expect(h.attach).not.toHaveBeenCalled();
  await act(async () => click("thread.openWebChat"));
  expect(host.textContent).toContain("web:/messages/chat");
  await act(async () => click("thread.backToChat"));
  expect(host.textContent).toContain("thread.communityChat");
});

it("removes the native community composer and history after access is revoked", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "community" };
  await render();
  expect(host.querySelector("input")).not.toBeNull();
  h.detail = undefined;
  h.messages = [];
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).not.toContain("Hello buyer");
  expect(h.send).not.toHaveBeenCalled();
});

it("restores a pending text request after remount and only sends on explicit retry", async () => {
  h.outboxRead.mockReturnValue({
    body: "Saved note",
    clientKey: "original-key",
    attachments: [],
    mentions: [],
    tasks: [],
  });
  h.send.mockResolvedValue(message);
  await render();
  expect(host.querySelector("input")!.value).toBe("Saved note");
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(h.send).not.toHaveBeenCalled();
  await act(async () => click("inbox.retry"));
  expect(h.outboxSave.mock.invocationCallOrder[0]).toBeLessThan(h.send.mock.invocationCallOrder[0]);
  expect(h.send).toHaveBeenCalledWith("chat", {
    body: "Saved note",
    clientKey: "original-key",
    mentions: [],
    tasks: [],
  });
  expect(h.outboxClear).toHaveBeenLastCalledWith("original-key");
});
it("does not send when the pending request cannot be saved", async () => {
  h.outboxSave.mockImplementation(() => {
    throw new Error("Storage full");
  });
  await render();
  await act(async () => type("Keep me"));
  await act(async () => click("thread.send"));
  expect(h.send).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Storage full");
  expect(host.querySelector("input")!.value).toBe("Keep me");
  expect(host.querySelector("input")!.disabled).toBe(false);
  h.outboxSave.mockImplementation(() => undefined);
  h.send.mockResolvedValue(message);
  await act(async () => type("Edited before any send"));
  await act(async () => click("thread.send"));
  expect(h.send).toHaveBeenCalledWith("chat", {
    body: "Edited before any send",
    clientKey: "stable-key",
  });
});
it("does not overwrite unreadable pending messages", async () => {
  h.outboxRead.mockImplementation(() => {
    throw new Error("Unreadable outbox");
  });
  await render();
  expect(host.textContent).toContain("Unreadable outbox");
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(h.outboxSave).not.toHaveBeenCalled();
});
it("restores attachment-only sends without uploading the same file again", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  const saved = {
    body: "",
    clientKey: "attachment-key",
    attachments: [{ source: "upload", mediaAssetId: "media", name: "Shot.mp4" }],
    mentions: [],
    tasks: [],
  };
  h.outboxRead.mockReturnValue(saved);
  h.attach.mockResolvedValue(message);
  await render();
  expect(host.textContent).toContain("thread.pendingAttachments");
  await act(async () => click("inbox.retry"));
  expect(h.attach).toHaveBeenCalledWith(h.detail, "buyer", saved);
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.outboxClear).toHaveBeenCalledWith("attachment-key");
});

it("clears an acknowledged durable request even when the composer has unmounted", async () => {
  let finish!: (value: NativeMessage) => void;
  h.send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () => type("Sent before leaving"));
  await act(async () => click("thread.send"));
  await act(async () => root.render(null));
  await act(async () => finish(message));
  expect(h.outboxClear).toHaveBeenCalledWith("stable-key");
  expect(h.refresh).not.toHaveBeenCalled();
});

it("opens a crew attachment's exact asset and returns to the conversation", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  h.messages = [
    {
      ...message,
      type: "file",
      payload: {
        kind: "attachments",
        attachments: [
          {
            assetNodeId: "node",
            mediaAssetId: "media",
            name: "Shot.mp4",
            mediaKind: "video",
            contentType: "video/mp4",
            sizeBytes: 1024,
          },
        ],
      },
    },
  ];
  await render();
  await act(async () => click("thread.openInCrewAssets"));
  expect(host.textContent).toContain("asset-detail:crew:node");
  expect(host.textContent).not.toContain("file:Shot.mp4");
  h.active = false;
  await render();
  expect(host.textContent).toContain("asset-detail:crew:node");
  h.active = true;
  await render();
  await act(async () => click("thread.backToChat"));
  expect(host.textContent).toContain("file:Shot.mp4");
  h.detail = { ...detail, contextType: "order" };
  await render();
  expect(host.textContent).not.toContain("thread.openInCrewAssets");
});

it("requires a new visibility observation after return and keeps the unsent draft", async () => {
  await render();
  await act(async () => type("Keep my draft"));
  expect(new Set(h.viewCallbacks).size).toBe(1);
  const previousView = h.view!;
  await act(async () =>
    previousView({ viewableItems: [{ item: message, index: 0, isViewable: true }] })
  );
  expect(h.read).toHaveBeenCalledTimes(1);
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.querySelector("input")!.value).toBe("Keep my draft");
  expect(h.read).toHaveBeenCalledTimes(1);
  await act(async () =>
    previousView({ viewableItems: [{ item: message, index: 0, isViewable: true }] })
  );
  expect(h.read).toHaveBeenCalledTimes(1);
  await act(async () =>
    h.view!({ viewableItems: [{ item: message, index: 0, isViewable: true }] })
  );
  expect(h.read).toHaveBeenCalledTimes(2);
});

it("finishes file selection after a background handoff without uploading twice", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  let finish!: (value: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => click("thread.uploadFile"));
  const signal = h.upload.mock.calls[0][1] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(false);
  h.active = true;
  await render();
  await act(async () => finish({ source: "upload", mediaAssetId: "media", name: "Selected.mp4" }));
  expect(host.textContent).toContain("Selected.mp4");
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.attach).not.toHaveBeenCalled();
});
it("aborts file selection on route blur and ignores the late picker result", async () => {
  h.detail = { ...detail, contextType: "crew", crewChannel: "team", contextId: "crew" };
  let finish!: (value: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => click("thread.uploadFile"));
  const signal = h.upload.mock.calls[0][1] as AbortSignal;
  h.active = false;
  h.focused = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ source: "upload", mediaAssetId: "media", name: "Retired.mp4" }));
  h.active = true;
  h.focused = true;
  await render();
  expect(host.textContent).not.toContain("Retired.mp4");
  expect(h.attach).not.toHaveBeenCalled();
});
