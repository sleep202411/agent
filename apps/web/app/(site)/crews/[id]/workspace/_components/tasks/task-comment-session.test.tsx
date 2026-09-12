import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { TaskIssueDetail } from "./task-issue-detail";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  create: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCreateCrewTaskComment: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateCrewTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCrewTaskTimeline: () => ({ data: { pages: [{ items: [] }] } }),
  useCrewTaskProject: () => ({
    data: { views: [], fields: [], labels: [], cycles: [], workflowStates: [] },
  }),
  useCrewEpisodes: () => ({ data: [] }),
  useCrewTaskOptions: () => ({ data: [] }),
}));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssetContext: () => ({ data: { capabilities: { upload: true } } }),
  useCrewAssets: () => ({ data: { items: [] } }),
  discardPendingCrewAssetUpload: state.discard,
}));
vi.mock("@/src/lib/media-upload", () => ({ uploadFileViaSignedUrl: state.upload }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ displayNameOf: (id: string) => id }));
vi.mock("@/app/(site)/crews/_hooks/use-position-label", () => ({
  useCrewMemberPositionLabel: () => () => "member",
}));
vi.mock("./task-quick-create", () => ({ TaskQuickCreate: () => null }));
vi.mock("./delete-task-button", () => ({ DeleteTaskButton: () => null }));
vi.mock("./task-review-form", () => ({ TaskReviewForm: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: state.error } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
state.discard.mockResolvedValue(undefined);
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
async function render(id = "task", account = "alice") {
  await act(async () =>
    root.render(
      <TaskIssueDetail
        key={`${id}:${account}`}
        task={
          {
            id,
            crewId: "crew",
            status: "open",
            workflowState: { systemKey: "open", name: "Open" },
            title: "Task",
            description: "",
            createdAt: new Date().toISOString(),
            assignees: [],
            children: [],
            blockedBy: [],
            labels: [],
            customFieldValues: [],
            revisionLimit: null,
            version: 1,
          } as unknown as CrewTaskDTO
        }
        viewerUserId={account}
        members={[]}
        displays={new Map()}
        isOwner={false}
        canWork={true}
        onSubmit={vi.fn()}
        onReviewed={vi.fn()}
      />
    )
  );
}
function field() {
  return container.querySelector(
    'textarea[placeholder="commentPlaceholder"]'
  ) as HTMLTextAreaElement;
}
async function fill(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field(),
      text
    );
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function send() {
  field().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
  );
}
async function upload(files: File[]) {
  await act(async () => {
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.discard.mockResolvedValue(undefined);
});
it("blocks duplicate comment sends and reuses the retry key for unchanged input", async () => {
  const pending = deferred<void>();
  state.create.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await render();
  await fill("Keep this");
  await act(async () => {
    send();
    send();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(field().disabled).toBe(true);
  const key = state.create.mock.calls[0]![0].clientKey;
  await act(async () => pending.reject(new Error("response lost")));
  expect(field().value).toBe("Keep this");
  await act(async () => send());
  expect(state.create.mock.calls[1]![0].clientKey).toBe(key);
  expect(field().value).toBe("");
  await fill("Keep this");
  await act(async () => send());
  expect(state.create.mock.calls[2]![0].clientKey).not.toBe(key);
});
it("blocks keyboard submission and overlapping uploads until upload finishes", async () => {
  const pending = deferred<{ mediaAssetId: string }>();
  state.upload.mockReturnValue(pending.promise);
  await render();
  await fill("File note");
  await upload([new File(["x"], "one.png")]);
  await act(async () => send());
  await upload([new File(["y"], "two.png")]);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.upload).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ mediaAssetId: "asset" }));
  expect(container.textContent).toContain("one.png");
});
it("discards a late upload and stops remaining files after closing", async () => {
  const pending = deferred<{ mediaAssetId: string }>();
  state.upload.mockReturnValue(pending.promise);
  await render();
  await upload([new File(["x"], "one.png"), new File(["y"], "two.png")]);
  await act(async () => root.render(null));
  await act(async () => pending.resolve({ mediaAssetId: "late" }));
  expect(state.discard).toHaveBeenCalledWith("crew", "late");
  expect(state.upload).toHaveBeenCalledTimes(1);
});
it("does not delete submitted attachments while a comment is awaiting confirmation", async () => {
  state.upload.mockResolvedValue({ mediaAssetId: "attached" });
  const pending = deferred<void>();
  state.create.mockReturnValue(pending.promise);
  await render();
  await upload([new File(["x"], "one.png")]);
  await act(async () => send());
  await act(async () => root.render(null));
  expect(state.discard).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(state.discard).not.toHaveBeenCalled();
});
it("ignores failed comment results after switching accounts", async () => {
  const pending = deferred<void>();
  state.create.mockReturnValue(pending.promise);
  await render();
  await fill("Old");
  await act(async () => send());
  await render("task", "bob");
  await fill("New");
  await act(async () => pending.reject(new Error("old failure")));
  expect(state.error).not.toHaveBeenCalled();
  expect(field().value).toBe("New");
});

it("uses a new retry key when the comment input changes", async () => {
  state.create.mockRejectedValueOnce(new Error("try again")).mockResolvedValue(undefined);
  await render();
  await fill("first");
  await act(async () => send());
  const key = state.create.mock.calls[0]![0].clientKey;
  await fill("revised");
  await act(async () => send());
  expect(state.create.mock.calls[1]![0].clientKey).not.toBe(key);
});
it("aborts uploads and suppresses late upload failures after closing", async () => {
  const pending = deferred<{ mediaAssetId: string }>();
  state.upload.mockReturnValue(pending.promise);
  await render();
  await upload([new File(["x"], "one.png")]);
  const signal = state.upload.mock.calls[0]![1].signal as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.reject(new Error("cancelled upload")));
  expect(state.error).not.toHaveBeenCalled();
});
it("cleans up an unsubmitted attachment after closing", async () => {
  state.upload.mockResolvedValue({ mediaAssetId: "unused" });
  await render();
  await upload([new File(["x"], "one.png")]);
  await act(async () => root.render(null));
  expect(state.discard).toHaveBeenCalledWith("crew", "unused");
});
