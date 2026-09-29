import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskComment } from "./task-comment";
const h = vi.hoisted(() => ({
  permission: vi.fn(),
  picker: vi.fn(),
  post: vi.fn(),
  sent: vi.fn(),
  generation: 1,
  active: true,
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
  fetchTaskCommentPermission: h.permission,
  postTaskComment: h.post,
}));
vi.mock("./inquiry-api", () => ({ inquiryKey: () => "stable" }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
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
  h.active = true;
  h.generation = 1;
  h.permission.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("withholds composition without comment permission and retries permission failures", async () => {
  h.permission.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(false);
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
  h.permission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
  expect(availability).toHaveBeenLastCalledWith({ allowed: true, locked: false });
  await act(async () => type("Reply"));
  h.post.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce({});
  await act(async () => host.querySelectorAll("button")[1]!.click());
  expect(availability).toHaveBeenLastCalledWith({ allowed: true, locked: true });
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
it("removes selected files without deleting assets and aborts the picker on background", async () => {
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
