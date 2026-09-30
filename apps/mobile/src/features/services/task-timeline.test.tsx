import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskTimeline } from "./task-timeline";
import type { TaskActivity } from "./task-timeline-api";
const h = vi.hoisted(() => ({
  items: [] as TaskActivity[],
  more: vi.fn(),
  allowed: false,
  locked: false,
  canManage: false,
  refresh: vi.fn(),
  composer: vi.fn(),
  retry: vi.fn(),
  error: undefined as string | undefined,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("./task-comment-edit", () => ({
  TaskCommentEdit: ({ disabled }: { disabled: boolean }) => (
    <button disabled={disabled}>edit-comment</button>
  ),
}));
vi.mock("./task-comment-remove", () => ({
  TaskCommentRemove: ({ onRemoved, disabled }: { onRemoved: () => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={onRemoved}>
      remove-comment
    </button>
  ),
}));
vi.mock("./task-comment", () => ({
  TaskComment: function MockComment(props: {
    reply?: { id: string };
    onReplyAvailability: (value: {
      allowed: boolean;
      locked: boolean;
      canManage?: boolean;
    }) => void;
  }) {
    const { onReplyAvailability } = props;
    h.composer(props);
    const { allowed, locked, canManage } = h;
    useEffect(() => {
      onReplyAvailability({ allowed, locked, canManage });
    }, [onReplyAvailability, allowed, locked, canManage]);
    return null;
  },
}));
vi.mock("./use-task-timeline", () => ({
  useTaskTimeline: () => ({
    items: h.items,
    hasMore: true,
    loading: false,
    error: h.error,
    loadMore: h.more,
    retry: h.retry,
    refresh: h.refresh,
  }),
}));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["1", { nickname: "Artist" }]]),
}));
vi.mock("./conversation-file", () => ({
  ConversationFile: ({ name }: { name: string }) => <div>file:{name}</div>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const item: TaskActivity = {
  id: "one",
  taskId: "task",
  kind: "comment",
  version: 1,
  mentions: [],
  actorUserId: "1",
  body: "Reply note",
  createdAt: "2026-09-29T00:00:00Z",
  deletedAt: null,
  editedAt: "2026-09-29T01:00:00Z",
  payload: {},
  replyTo: { id: "parent", body: "Parent secret", deleted: true },
  attachments: [
    {
      id: "file",
      mediaAssetId: "media",
      name: "Clip",
      mediaKind: "video",
      contentType: "video/mp4",
    },
  ],
};
const render = () =>
  act(async () =>
    root.render(<TaskTimeline crewId="crew" taskId="task" generation={1} userId="1" />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.allowed = false;
  h.locked = false;
  h.canManage = false;
  h.items = [item];
  h.error = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows reply context, edits, authorized files and explicit older-page loading", async () => {
  await render();
  for (const text of [
    "Artist",
    "Reply note",
    "taskActivity.deleted",
    "taskActivity.edited",
    "file:Clip",
  ])
    expect(host.textContent).toContain(text);
  expect(host.textContent).not.toContain("Parent secret");
  await act(async () => host.querySelector("button")!.click());
  expect(h.more).toHaveBeenCalledTimes(1);
});
it("never reveals a deleted comment body, reply or attachment and exposes retry", async () => {
  h.items = [{ ...item, deletedAt: item.createdAt }];
  h.error = "Access revoked";
  await render();
  expect(host.textContent).not.toContain("Reply note");
  expect(host.textContent).not.toContain("file:Clip");
  expect(host.textContent).toContain("Access revoked");
  await act(async () => host.querySelector("button")!.click());
  expect(h.retry).toHaveBeenCalledTimes(1);
});

it("allows replies only to live comments with permission and locks selection during retry", async () => {
  h.items = [
    item,
    { ...item, id: "deleted", deletedAt: item.createdAt },
    { ...item, id: "event", kind: "task.created" },
  ];
  await render();
  const replies = () =>
    Array.from(host.querySelectorAll("button")).filter(
      (b) => b.textContent === "taskActivity.replyAction"
    );
  expect(replies()).toHaveLength(0);
  h.allowed = true;
  await render();
  expect(replies()).toHaveLength(1);
  await act(async () => replies()[0]!.click());
  expect(h.composer.mock.calls.at(-1)![0].reply).toEqual({ id: "one", body: "Reply note" });
  h.locked = true;
  await render();
  expect(replies()[0]!.disabled).toBe(true);
  h.allowed = false;
  await render();
  expect(replies()).toHaveLength(0);
});

it("limits removal to live comments by self or explicit task managers", async () => {
  h.items = [
    item,
    { ...item, id: "other", actorUserId: "2" },
    { ...item, id: "gone", deletedAt: item.createdAt },
    { ...item, id: "event", kind: "task.created" },
  ];
  const removals = () =>
    Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "remove-comment");
  await render();
  expect(removals()).toHaveLength(0);
  h.allowed = true;
  await render();
  expect(removals()).toHaveLength(1);
  expect(
    Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "edit-comment")
  ).toHaveLength(1);
  await act(async () => removals()[0]!.click());
  expect(h.refresh).toHaveBeenCalledTimes(1);
  h.canManage = true;
  await render();
  expect(removals()).toHaveLength(2);
  h.locked = true;
  await render();
  expect(removals().every((b) => b.disabled)).toBe(true);
  h.error = "Forbidden";
  await render();
  expect(removals()).toHaveLength(0);
});
