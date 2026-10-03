import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskComment } from "./task-comment";
const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  permission: vi.fn(),
  picker: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  post: vi.fn(),
  sent: vi.fn(),
  generation: 1,
  active: true,
  focused: true,
}));
vi.mock("./task-comment-outbox", () => ({
  taskCommentOutbox: () => ({ read: h.read, save: h.save, clear: h.clear }),
}));
vi.mock("./task-mention-picker", () => ({
  TaskMentionPicker: ({ onSelect }: { onSelect: (v: unknown) => void }) => (
    <button onClick={() => onSelect({ userId: "2", label: "Artist" })}>select-member</button>
  ),
}));
vi.mock("@/features/crew-assets/upload", () => ({
  pickAndUploadCrewFile: h.upload,
  discardCrewUpload: h.discard,
}));
vi.mock("@/features/crew-assets/asset-picker", () => ({
  CrewAssetPicker: (props: { onSelect: (assets: unknown[]) => void; onClose: () => void }) => {
    h.picker(props);
    return (
      <div>
        <button onClick={() => props.onSelect([{ id: "asset", name: "Scene.mp4" }])}>
          select-file
        </button>
        <button onClick={props.onClose}>close-picker</button>
      </div>
    );
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./task-comment-api", () => ({
  fetchTaskCommentAccess: h.permission,
  postTaskComment: h.post,
}));
vi.mock("@/lib/client-request-key", () => ({ clientRequestKey: () => "stable" }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
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
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () =>
    root.render(
      <TaskComment crewId="crew" taskId="task" userId="1" generation={1} onSent={h.sent} />
    )
  );
const click = () => host.querySelector("button")!.click();
const type = (text: string) => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.read.mockReturnValue(null);
  h.active = true;
  h.focused = true;
  h.generation = 1;
  h.permission.mockResolvedValue({ allowed: true, canManage: false });
  h.discard.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("withholds composition without comment permission and retries permission failures", async () => {
  h.permission
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ allowed: false, canManage: false });
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("Offline");
  await act(async () => click());
  expect(host.querySelector("input")).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
it("guards rapid sends and preserves exact text/key for uncertain retry", async () => {
  h.post.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce({});
  await render();
  await act(async () => type(" Note "));
  await act(async () => {
    click();
    click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(host.textContent).toContain("Timeout");
  await act(async () => click());
  expect(h.post.mock.calls).toEqual([
    ["task", "1", { body: "Note", clientKey: "stable" }],
    ["task", "1", { body: "Note", clientKey: "stable" }],
  ]);
  expect(h.sent).toHaveBeenCalledTimes(1);
  expect(host.querySelector("input")!.value).toBe("");
});
it("rechecks permissions when the backend revokes access", async () => {
  h.post.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  h.permission
    .mockResolvedValueOnce({ allowed: true, canManage: false })
    .mockResolvedValueOnce({ allowed: false, canManage: false });
  await render();
  await act(async () => type("Note"));
  await act(async () => click());
  expect(h.permission).toHaveBeenCalledTimes(2);
  expect(host.querySelector("input")).toBeNull();
});
it("suppresses send callbacks after account change and aborts permission checks on background", async () => {
  let finish!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.permission.mock.calls[0][2];
  await act(async () => type("Note"));
  await act(async () => click());
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  h.generation = 2;
  await act(async () => finish({}));
  expect(h.sent).not.toHaveBeenCalled();
});

it("locks the reply preview and retry payload to the submitted target", async () => {
  const clear = vi.fn(),
    availability = vi.fn();
  const show = (id: string, body: string) =>
    act(async () =>
      root.render(
        <TaskComment
          crewId="crew"
          taskId="task"
          userId="1"
          generation={1}
          onSent={h.sent}
          reply={{ id, body }}
          onClearReply={clear}
          onReplyAvailability={availability}
        />
      )
    );
  await show("first", "Original note");
  expect(availability).toHaveBeenLastCalledWith({ allowed: true, locked: false, canManage: false });
  await act(async () => type("Reply"));
  h.post.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce({});
  await act(async () => host.querySelectorAll("button")[1]!.click());
  expect(availability).toHaveBeenLastCalledWith({ allowed: true, locked: true, canManage: false });
  expect(host.querySelector("button")!.disabled).toBe(true);
  await show("second", "New target");
  expect(host.textContent).toContain("Original note");
  expect(host.textContent).not.toContain("New target");
  await act(async () => host.querySelectorAll("button")[1]!.click());
  expect(h.post.mock.calls).toEqual([
    ["task", "1", { body: "Reply", clientKey: "stable", replyToId: "first" }],
    ["task", "1", { body: "Reply", clientKey: "stable", replyToId: "first" }],
  ]);
  expect(clear).toHaveBeenCalledTimes(1);
});
it("cancels an unsubmitted reply without posting or clearing the text draft", async () => {
  const clear = vi.fn();
  await act(async () =>
    root.render(
      <TaskComment
        crewId="crew"
        taskId="task"
        userId="1"
        generation={1}
        onSent={h.sent}
        reply={{ id: "target", body: null }}
        onClearReply={clear}
      />
    )
  );
  await act(async () => type("Keep draft"));
  await act(async () => click());
  expect(clear).toHaveBeenCalledTimes(1);
  expect(h.post).not.toHaveBeenCalled();
  expect(host.querySelector("input")!.value).toBe("Keep draft");
});

it("sends existing Crew files without text and retries the exact attachment set", async () => {
  const byText = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  await render();
  expect(byText("taskActivity.sendComment").disabled).toBe(true);
  await act(async () => byText("crewAssets.choose").click());
  expect(h.picker.mock.calls.at(-1)![0]).toMatchObject({
    crewId: "crew",
    excludedIds: [],
    remaining: 10,
  });
  await act(async () => byText("select-file").click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("Scene.mp4");
  h.post.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({});
  await act(async () => byText("taskActivity.sendComment").click());
  expect(byText("crewAssets.choose").disabled).toBe(true);
  expect(byText("Scene.mp4 · crewAssets.remove").disabled).toBe(true);
  await act(async () => byText("inbox.retry").click());
  const request = [
    "task",
    "1",
    { body: "", clientKey: "stable", attachments: [{ source: "asset", assetNodeId: "asset" }] },
  ];
  expect(h.post.mock.calls).toEqual([request, request]);
  expect(host.textContent).not.toContain("Scene.mp4");
});
it("removes selected files without deleting assets and hides the asset picker on background", async () => {
  const byText = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  await render();
  await act(async () => byText("crewAssets.choose").click());
  await act(async () => byText("select-file").click());
  await act(async () => byText("Scene.mp4 · crewAssets.remove").click());
  expect(byText("taskActivity.sendComment").disabled).toBe(true);
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => byText("crewAssets.choose").click());
  h.active = false;
  await render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("uploads once, reserves picker capacity and retries confirmed media without re-uploading", async () => {
  const file = { source: "upload", mediaAssetId: "media", name: "New.mp4" };
  const byText = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  h.upload.mockResolvedValue(file);
  await render();
  await act(async () => {
    byText("thread.uploadFile").click();
    byText("thread.uploadFile").click();
  });
  expect(h.upload).toHaveBeenCalledTimes(1);
  await act(async () => byText("crewAssets.choose").click());
  expect(h.picker.mock.calls.at(-1)![0].remaining).toBe(9);
  await act(async () => byText("close-picker").click());
  h.post.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce({});
  await act(async () => byText("taskActivity.sendComment").click());
  expect(byText("New.mp4 · crewAssets.remove").disabled).toBe(true);
  await act(async () => byText("inbox.retry").click());
  expect(h.post.mock.calls).toEqual([
    ["task", "1", { body: "", clientKey: "stable", attachments: [file] }],
    ["task", "1", { body: "", clientKey: "stable", attachments: [file] }],
  ]);
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.discard).not.toHaveBeenCalled();
});
it("cleans removed unsent uploads but retains uploads after an uncertain send", async () => {
  const byText = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  h.upload.mockResolvedValue({ source: "upload", mediaAssetId: "media", name: "New.mp4" });
  await render();
  await act(async () => byText("thread.uploadFile").click());
  await act(async () => byText("New.mp4 · crewAssets.remove").click());
  expect(h.discard).toHaveBeenCalledExactlyOnceWith("crew", "media");
  h.discard.mockClear();
  await act(async () => byText("thread.uploadFile").click());
  h.post.mockRejectedValue(new Error("Timeout"));
  await act(async () => byText("taskActivity.sendComment").click());
  h.active = false;
  await render();
  expect(h.discard).not.toHaveBeenCalled();
});
it("aborts in-flight upload on leaving, cleans a late same-account upload and never submits it", async () => {
  let finish!: (v: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "thread.uploadFile")!
      .click()
  );
  const signal = h.upload.mock.calls[0][1];
  expect(host.querySelector("button")!.disabled).toBe(true);
  h.active = false;
  h.focused = false;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ source: "upload", mediaAssetId: "media", name: "Late" }));
  expect(h.discard).toHaveBeenCalledExactlyOnceWith("crew", "media");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not clean a former account's upload with the new account", async () => {
  h.upload.mockResolvedValue({ source: "upload", mediaAssetId: "media", name: "New" });
  await render();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "thread.uploadFile")!
      .click()
  );
  h.generation = 2;
  await render();
  expect(h.discard).not.toHaveBeenCalled();
});

it("inserts a structured mention and keeps it frozen for uncertain retries", async () => {
  const button = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  await render();
  await act(async () => button("thread.mention").click());
  await act(async () => button("select-member").click());
  expect(host.querySelector("input")!.value).toBe("@Artist ");
  h.post.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce({});
  await act(async () => button("taskActivity.sendComment").click());
  expect(button("thread.mention").disabled).toBe(true);
  await act(async () => button("inbox.retry").click());
  expect(h.post.mock.calls).toEqual(
    Array(2).fill([
      "task",
      "1",
      { body: "@Artist", clientKey: "stable", mentions: [{ userId: "2", label: "Artist" }] },
    ])
  );
});
it("removes structured mentions when their label is removed from the draft", async () => {
  const button = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  await render();
  await act(async () => button("thread.mention").click());
  await act(async () => button("select-member").click());
  await act(async () => type("No mention"));
  h.post.mockResolvedValue({});
  await act(async () => button("taskActivity.sendComment").click());
  expect(h.post).toHaveBeenCalledWith("task", "1", { body: "No mention", clientKey: "stable" });
});

it("restores an attachment-only reply and retries its exact request without uploading again", async () => {
  const comment = {
    body: "",
    clientKey: "old-key",
    replyToId: "reply-id",
    attachments: [{ source: "upload", mediaAssetId: "media", name: "Recovered.mp4" }],
  };
  h.read.mockReturnValue({
    clientKey: "old-key",
    comment,
    reply: { id: "reply-id", body: "Original parent" },
  });
  h.post.mockResolvedValue({});
  await render();
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(host.textContent).toContain("Original parent");
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "inbox.retry")!.click()
  );
  expect(h.post).toHaveBeenCalledWith("task", "1", comment);
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.discard).not.toHaveBeenCalled();
  expect(h.save.mock.invocationCallOrder[0]).toBeLessThan(h.post.mock.invocationCallOrder[0]);
  expect(h.clear).toHaveBeenCalledWith("old-key");
});
it("does not send or lock composition when storage fails before submission", async () => {
  h.save.mockImplementation(() => {
    throw new Error("Disk full");
  });
  await render();
  await act(async () => type("New comment"));
  await act(async () => click());
  expect(h.post).not.toHaveBeenCalled();
  expect(host.querySelector("input")!.disabled).toBe(false);
  expect(host.textContent).toContain("Disk full");
});

it("retains text and finishes native file selection across a background handoff", async () => {
  let finish!: (value: unknown) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => type("Keep this comment"));
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "thread.uploadFile")!.click()
  );
  const signal = h.upload.mock.calls[0][1] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(false);
  expect(host.querySelector("input")).toBeNull();
  await act(async () => finish({ source: "upload", mediaAssetId: "media", name: "Selected.mp4" }));
  h.active = true;
  await render();
  expect(host.querySelector("input")!.value).toBe("Keep this comment");
  expect(host.textContent).toContain("Selected.mp4");
  expect(h.permission).toHaveBeenCalledTimes(2);
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.post).not.toHaveBeenCalled();
  expect(h.discard).not.toHaveBeenCalled();
});
it("withholds preserved composition while fresh permission is pending or revoked", async () => {
  await render();
  await act(async () => type("Private draft"));
  h.active = false;
  await render();
  let finish!: (value: unknown) => void;
  h.permission.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  h.active = true;
  await render();
  expect(host.querySelector("input")).toBeNull();
  await act(async () => finish({ allowed: false }));
  expect(host.querySelector("input")).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
