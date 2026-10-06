import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO, CrewTaskTimelineItemDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { TaskIssueDetail } from "./task-issue-detail";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  create: vi.fn(),
  timelineError: false,
  pageError: false,
  fetching: false,
  refetch: vi.fn(),
  nextPage: vi.fn(),
  patch: vi.fn(),
  owner: false,
  quoteFee: null as string | null,
  canReview: false,
  canSubmitAssigned: true,
  canComment: true,
  canWork: true,
  status: "open" as "open" | "submitted",
  custom: false,
  customValue: "custom-original",
  limit: null as number | null,
  version: 1,
  title: "Task",
  update: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  items: [] as CrewTaskTimelineItemDTO[],
  upload: vi.fn(),
  discard: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CREW_TASK_KINDS: [
    "script",
    "gameplay",
    "plot_tree",
    "art",
    "storyboard",
    "voice",
    "music",
    "edit",
    "qa",
    "other",
  ],
  CREW_TASK_KIND_MESSAGE_KEYS: {
    script: "taskKindScript",
    gameplay: "taskKindGameplay",
    plot_tree: "taskKindPlotTree",
    art: "taskKindArt",
    storyboard: "taskKindStoryboard",
    voice: "taskKindVoice",
    music: "taskKindMusic",
    edit: "taskKindEdit",
    qa: "taskKindQa",
    other: "taskKindOther",
  },
  useUpdateCrewTaskComment: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteCrewTaskComment: () => ({ mutateAsync: state.remove, isPending: false }),
  useCreateCrewTaskComment: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateCrewTask: () => ({ mutateAsync: state.patch, isPending: false }),
  useSetTaskDeliveryFolder: () => ({ mutateAsync: state.patch, isPending: false }),
  useCrewTaskTimeline: () => ({
    data: { pages: [{ items: state.items }] },
    isError: state.timelineError,
    isFetchNextPageError: state.pageError,
    error: new Error("timeline unavailable"),
    isFetching: state.fetching,
    refetch: state.refetch,
    fetchNextPage: state.nextPage,
    hasNextPage: true,
  }),
  useCrewTaskProject: () => ({
    data: {
      views: [],
      fields: state.custom ? [{ id: "field", name: "Custom text", type: "text", options: [] }] : [],
      labels: [],
      cycles: [],
      workflowStates: [],
    },
  }),
  useCrewEpisodes: () => ({ data: [] }),
  useCrewTaskOptions: () => ({ data: [] }),
}));
const attachmentQuery = vi.hoisted(() => ({
  data: { items: [] as Array<{ id: string; name: string }> },
  hasNextPage: false,
  isLoading: false,
  isFetching: false,
  isError: false,
  isFetchNextPageError: false,
  error: null as Error | null,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssetContext: () => ({ data: { capabilities: { upload: true } } }),
  useCrewAssets: () => attachmentQuery,
  useCrewAssetFolders: () => ({
    data: [] as Array<{ id: string; name: string; permissions: string[] }>,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  discardPendingCrewAssetUpload: state.discard,
}));
vi.mock("@/src/lib/media-upload", () => ({ uploadFileViaSignedUrl: state.upload }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ displayNameOf: (id: string) => id }));
vi.mock("@/app/(site)/crews/_hooks/use-position-label", () => ({
  useCrewMemberPositionLabel: () => () => "member",
}));
vi.mock("@/app/(site)/crews/_components/task-agreed-fee", () => ({
  TaskAgreedFee: ({ onUse }: { onUse: (currency: "USD", amount: string) => void }) => (
    <button onClick={() => onUse("USD", state.quoteFee!)}>Use agreed fee</button>
  ),
}));
// Private contract browsing/upload is covered by task-contract-files.test.tsx.
vi.mock("@/app/(site)/crews/_components/task-contract-files", () => ({
  TaskContractFiles: () => null,
}));
vi.mock("@/app/(site)/crews/_components/task-invite-dialog", () => ({
  TaskInviteDialog: () => null,
}));
vi.mock("./task-quick-create", () => ({ TaskQuickCreate: () => null }));
vi.mock("./delete-task-button", () => ({ DeleteTaskButton: () => null }));
vi.mock("./task-review-form", () => ({
  TaskReviewForm: () => <div data-testid="task-review-form" />,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
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
            status: state.status,
            workflowState: { systemKey: "open", name: "Open" },
            title: state.title,
            description: "",
            createdAt: new Date().toISOString(),
            assignees: [],
            submissions: [],
            children: [],
            blockedBy: [],
            labels: [],
            customFieldValues: state.custom ? [{ fieldId: "field", value: state.customValue }] : [],
            revisionLimit: state.limit,
            version: state.version,
          } as unknown as CrewTaskDTO
        }
        viewerUserId={account}
        members={state.quoteFee === null ? [] : [{ id: "membership", userId: "member" } as never]}
        displays={new Map()}
        isOwner={state.owner}
        canReview={state.canReview}
        canWork={state.canWork}
        canSubmitAssigned={state.canSubmitAssigned}
        canComment={state.canComment}
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
  attachmentQuery.data = { items: [] };
  attachmentQuery.hasNextPage = false;
  attachmentQuery.isError = false;
  attachmentQuery.error = null;
  attachmentQuery.isFetchNextPageError = false;
  state.items = [];
  state.timelineError = false;
  state.pageError = false;
  state.fetching = false;
  state.owner = false;
  state.quoteFee = null;
  state.canReview = false;
  state.canSubmitAssigned = true;
  state.canComment = true;
  state.canWork = true;
  state.status = "open";
  state.custom = false;
  state.customValue = "custom-original";
  state.limit = null;
  state.version = 1;
  state.title = "Task";
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

function comment() {
  state.items = [
    {
      id: "comment",
      kind: "comment",
      actorUserId: "alice",
      body: "original",
      version: 1,
      createdAt: new Date().toISOString(),
      mentions: [],
      attachments: [],
    } as unknown as CrewTaskTimelineItemDTO,
  ];
}
function row() {
  return container.querySelector("article")!;
}
function rowButton(text: string) {
  return Array.from(row().querySelectorAll("button")).find(
    (button) => button.textContent === text
  )!;
}
async function edit() {
  await act(async () =>
    (row().querySelector('[aria-label="editComment"]') as HTMLButtonElement).click()
  );
}
it("keeps a comment draft's original version across a collaborator refresh", async () => {
  comment();
  state.update.mockResolvedValue(undefined);
  await render();
  await edit();
  const textarea = row().querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "my draft"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state.items = [{ ...state.items[0]!, body: "collaborator text", version: 2 }];
  await render();
  expect(row().querySelector("textarea")!.value).toBe("my draft");
  await act(async () => rowButton("save").click());
  expect(state.update).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ body: "my draft", expectedVersion: 1 }),
    })
  );
});
it("prevents overlapping comment edits and retains the draft after failure", async () => {
  comment();
  const pending = deferred<void>();
  state.update.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await render();
  await edit();
  await act(async () => {
    rowButton("save").click();
    rowButton("save").click();
  });
  expect(state.update).toHaveBeenCalledTimes(1);
  expect(row().querySelector("textarea")!.disabled).toBe(true);
  await act(async () => pending.reject(new Error("edit failed")));
  expect(row().querySelector("textarea")!.value).toBe("original");
  await act(async () => rowButton("save").click());
  expect(state.update).toHaveBeenCalledTimes(2);
});
it("prevents duplicate comment deletions and permits retry", async () => {
  comment();
  const pending = deferred<void>();
  state.remove.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await render();
  await act(async () =>
    (row().querySelector('[aria-label="deleteComment"]') as HTMLButtonElement).click()
  );
  await act(async () => {
    rowButton("delete").click();
    rowButton("delete").click();
  });
  expect(state.remove).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("delete failed")));
  await act(async () => rowButton("delete").click());
  expect(state.remove).toHaveBeenCalledTimes(2);
});
it.each(["edit", "delete"])("ignores late comment %s results after leaving", async (action) => {
  comment();
  const pending = deferred<void>();
  state.update.mockReturnValue(pending.promise);
  state.remove.mockReturnValue(pending.promise);
  await render();
  if (action === "edit") {
    await edit();
    await act(async () => rowButton("save").click());
  } else {
    await act(async () =>
      (row().querySelector('[aria-label="deleteComment"]') as HTMLButtonElement).click()
    );
    await act(async () => rowButton("delete").click());
  }
  await act(async () => root.render(null));
  await act(async () => pending.resolve());
  expect(state.success).not.toHaveBeenCalled();
});

function textButton(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text
  )!;
}
async function brief() {
  await act(async () => textButton(state.title).click());
}
it("keeps the brief's edit version when task details refresh", async () => {
  state.owner = true;
  state.patch.mockResolvedValue(undefined);
  await render();
  await brief();
  state.version = 2;
  state.title = "New server title";
  await render();
  await act(async () => textButton("saveChanges").click());
  expect(state.patch).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ title: "Task", expectedVersion: 1 }),
    })
  );
});
it("blocks duplicate brief saves and preserves failure drafts", async () => {
  state.owner = true;
  const pending = deferred<void>();
  state.patch.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await render();
  await brief();
  await act(async () => {
    textButton("saveChanges").click();
    textButton("saveChanges").click();
  });
  expect(state.patch).toHaveBeenCalledTimes(1);
  expect((container.querySelector('input[maxlength="180"]') as HTMLInputElement).disabled).toBe(
    true
  );
  await act(async () => pending.reject(new Error("brief conflict")));
  expect(container.querySelector('input[maxlength="180"]')).not.toBeNull();
  await act(async () => textButton("saveChanges").click());
  expect(state.patch).toHaveBeenCalledTimes(2);
});
it.each(["success", "failure"])("ignores late task patch %s after leaving", async (outcome) => {
  state.owner = true;
  const pending = deferred<void>();
  state.patch.mockReturnValue(pending.promise);
  await render();
  await brief();
  await act(async () => textButton("saveChanges").click());
  await act(async () => root.render(null));
  await act(async () =>
    outcome === "success" ? pending.resolve() : pending.reject(new Error("old patch"))
  );
  expect(state.success).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});
it("loads the latest title when starting another brief edit", async () => {
  state.owner = true;
  await render();
  state.version = 2;
  state.title = "Updated";
  await render();
  await brief();
  expect((container.querySelector('input[maxlength="180"]') as HTMLInputElement).value).toBe(
    "Updated"
  );
});

it.each(["refresh", "page"])(
  "retains loaded comments and edits after a %s failure",
  async (kind) => {
    comment();
    await render();
    await edit();
    const textarea = row().querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "unsaved"
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    state.timelineError = true;
    state.pageError = kind === "page";
    await render();
    expect(row()).not.toBeNull();
    expect(row().querySelector("textarea")!.value).toBe("unsaved");
    expect(container.textContent).toContain("timeline unavailable");
    expect(
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "loadEarlier")
    ).toBeUndefined();
    await act(async () => textButton("retry").click());
    expect(kind === "page" ? state.nextPage : state.refetch).toHaveBeenCalledTimes(1);
    expect(kind === "page" ? state.refetch : state.nextPage).not.toHaveBeenCalled();
  }
);
it("waits for a timeline refresh before loading earlier comments", async () => {
  state.fetching = true;
  await render();
  expect(textButton("loadEarlier").disabled).toBe(true);
  await act(async () => textButton("loadEarlier").click());
  expect(state.nextPage).not.toHaveBeenCalled();
});

it.each(["assignees", "labels", "planning", "relationships", "limits"])(
  "preserves the open %s draft and its version during a refresh",
  async (kind) => {
    state.owner = true;
    state.patch.mockResolvedValue(undefined);
    await render();
    const matches = (text: string) =>
      kind === "assignees"
        ? text === "unassigned"
        : kind === "labels"
          ? text === "none"
          : kind === "planning"
            ? text.includes("estimate")
            : kind === "relationships"
              ? text === "noParentTask"
              : text.includes("revisionUnlimitedProgress");
    const trigger = Array.from(container.querySelectorAll("button")).find((button) =>
      matches(button.textContent ?? "")
    )!;
    await act(async () => trigger.click());
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    state.version = 2;
    await render();
    const panel = document.querySelector('[data-slot="popover-content"]')!;
    expect(panel).not.toBeNull();
    const save = Array.from(panel.querySelectorAll("button")).find(
      (button) => button.textContent === "save"
    )!;
    await act(async () => save.click());
    expect(state.patch).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ expectedVersion: 1 }) })
    );
  }
);

it("preserves custom-field drafts and their edit version across refreshes", async () => {
  state.owner = true;
  state.custom = true;
  state.patch.mockResolvedValue(undefined);
  await render();
  await act(async () => textButton("custom-original").click());
  const panel = document.querySelector('[data-slot="popover-content"]')!;
  const input = panel.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "custom draft"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state.version = 2;
  state.customValue = "server replacement";
  await render();
  expect((panel.querySelector("input") as HTMLInputElement).value).toBe("custom draft");
  await act(async () =>
    Array.from(panel.querySelectorAll("button"))
      .find((b) => b.textContent === "save")!
      .click()
  );
  expect(state.patch).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        expectedVersion: 1,
        customFieldValues: [{ fieldId: "field", value: "custom draft" }],
      }),
    })
  );
});
it("loads current revision settings when reopening after cancellation", async () => {
  state.owner = true;
  await render();
  await act(async () => textButton("revisionUnlimitedProgress").click());
  let panel = document.querySelector('[data-slot="popover-content"]')!;
  await act(async () =>
    Array.from(panel.querySelectorAll("button"))
      .find((b) => b.textContent === "cancel")!
      .click()
  );
  state.version = 2;
  state.limit = 5;
  await render();
  await act(async () => textButton("revisionProgress").click());
  panel = document.querySelector('[data-slot="popover-content"]')!;
  expect((panel.querySelector("input") as HTMLInputElement).value).toBe("5");
});

vi.mock("@/app/(site)/crews/_components/accountability/task-commitments", () => ({
  TaskCommitments: () => null,
}));
vi.mock("./task-delivery-template", () => ({ TaskDeliveryTemplatePanel: () => null }));

it.each([
  [false, true, "submitted", true],
  [true, false, "submitted", false],
  [true, true, "submitted", true],
  [false, false, "submitted", false],
  [false, true, "open", false],
] as const)(
  "review visibility with manage=%s review=%s status=%s",
  async (manage, review, status, visible) => {
    state.owner = manage;
    state.canReview = review;
    state.status = status;
    await render();
    expect(!!container.querySelector('[data-testid="task-review-form"]')).toBe(visible);
  }
);

it("removes the review form when review permission is revoked in the same session", async () => {
  state.owner = true;
  state.canReview = true;
  state.status = "submitted";
  await render();
  expect(container.querySelector('[data-testid="task-review-form"]')).not.toBeNull();
  state.canReview = false;
  await render();
  expect(container.querySelector('[data-testid="task-review-form"]')).toBeNull();
});

it.each([
  [true, true, "open", true],
  [true, false, "open", false],
  [false, true, "open", false],
  [true, true, "submitted", false],
] as const)(
  "submission visibility with work=%s submit=%s status=%s",
  async (work, submit, status, visible) => {
    state.canWork = work;
    state.canSubmitAssigned = submit;
    state.status = status;
    await render();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === "submit"
    );
    expect(!!button).toBe(visible);
  }
);

it("removes submission when permission is revoked without changing task access", async () => {
  await render();
  const hasSubmit = () =>
    Array.from(container.querySelectorAll("button")).some(
      (item) => item.textContent?.trim() === "submit"
    );
  expect(hasSubmit()).toBe(true);
  state.canSubmitAssigned = false;
  await render();
  expect(hasSubmit()).toBe(false);
  expect(field()).not.toBeNull();
});

it.each([
  [false, false, "alice", false],
  [true, false, "bob", false],
  [false, true, "alice", true],
  [true, true, "bob", true],
  [false, true, "bob", false],
] as const)(
  "comment controls with manage=%s comment=%s viewer=%s",
  async (manage, allowed, viewer, canEdit) => {
    comment();
    state.owner = manage;
    state.canComment = allowed;
    await render("task", viewer);
    expect(!!field()).toBe(allowed);
    expect(row().textContent).toContain("original");
    expect(!!row().querySelector('[aria-label="editComment"]')).toBe(canEdit);
    expect(!!row().querySelector('[aria-label="deleteComment"]')).toBe(canEdit);
  }
);

it("removes open comment editors and composer when permission is revoked", async () => {
  comment();
  await render();
  await edit();
  expect(row().querySelector("textarea")).not.toBeNull();
  state.canComment = false;
  await render();
  expect(field()).toBeNull();
  expect(row().querySelector("textarea")).toBeNull();
  expect(row().textContent).toContain("original");
  expect(state.update).not.toHaveBeenCalled();
});

it("loads older Crew files for a task comment and submits the chosen attachment", async () => {
  attachmentQuery.data = { items: [{ id: "new-file", name: "Recent file" }] };
  attachmentQuery.hasNextPage = true;
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="chooseCrewAsset"]')!.click()
  );
  const more = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "loadMore"
  );
  expect(more).toBeDefined();
  await act(async () => more!.click());
  expect(attachmentQuery.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false });
  attachmentQuery.data.items.push({ id: "old-file", name: "Older file" });
  await render();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Older file")!
      .click()
  );
  state.create.mockResolvedValue(undefined);
  await act(async () => send());
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({ attachments: [{ source: "asset", assetNodeId: "old-file" }] })
  );
});
it("shows attachment read errors instead of claiming the Crew has no files", async () => {
  attachmentQuery.isError = true;
  attachmentQuery.error = new Error("Files unavailable");
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="chooseCrewAsset"]')!.click()
  );
  expect(container.textContent).toContain("Files unavailable");
  expect(container.textContent).not.toContain("noRecentAssets");
});

it("restarts comment attachment discovery after an invalid cursor", async () => {
  attachmentQuery.isError = true;
  attachmentQuery.isFetchNextPageError = true;
  attachmentQuery.error = new CrewApiError(400, {
    code: "CREW_ASSET_CURSOR_INVALID",
    message: "Restart assets",
  });
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="chooseCrewAsset"]')!.click()
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "retry")!
      .click()
  );
  expect(attachmentQuery.refetch).toHaveBeenCalledTimes(1);
  expect(attachmentQuery.fetchNextPage).not.toHaveBeenCalled();
});

it.each([
  ["123.45", 12345],
  ["0.00", null],
] as const)("uses agreed fee %s in the actual assignment payload", async (fee, minor) => {
  state.owner = true;
  state.quoteFee = fee;
  state.patch.mockResolvedValue(undefined);
  await render();
  await act(async () => textButton("unassigned").click());
  const panel = document.querySelector('[data-slot="popover-content"]')!;
  await act(async () => (panel.querySelector('[role="checkbox"]') as HTMLButtonElement).click());
  await act(async () =>
    [...panel.querySelectorAll("button")].find((b) => b.textContent === "Use agreed fee")!.click()
  );
  await act(async () =>
    [...panel.querySelectorAll("button")].find((b) => b.textContent === "save")!.click()
  );
  expect(state.patch).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        assignees: [{ userId: "member", currency: "USD", rewardAmountMinor: minor }],
      }),
    })
  );
});

vi.mock("@/app/(site)/crews/_components/task-extension-panel", () => ({
  TaskExtensionPanel: () => null,
}));

vi.mock("@/app/(site)/crews/_components/task-closure-control", () => ({
  TaskClosureControl: () => null,
}));

it("shows the recorded closure reason without relabelling generic status changes", async () => {
  state.items = [
    {
      id: "closure-event",
      kind: "task.updated",
      actorUserId: "alice",
      createdAt: new Date().toISOString(),
      payload: {
        closureOutcome: "cancelled_without_financial_settlement",
        closure: { reason: "Project direction changed" },
      },
    } as unknown as CrewTaskTimelineItemDTO,
  ];
  await render();
  expect(container.textContent).toContain("activity.reasonedClosure");
  expect(container.textContent).toContain("Project direction changed");
  state.items = [
    {
      ...state.items[0]!,
      payload: { changedFields: { status: "cancelled" } },
    } as CrewTaskTimelineItemDTO,
  ];
  await render();
  expect(container.textContent).not.toContain("activity.reasonedClosure");
  expect(container.textContent).not.toContain("Project direction changed");
});

vi.mock("@/app/(site)/crews/_components/task-feedback-panel", () => ({
  TaskFeedbackPanel: () => null,
}));

vi.mock("@/app/(site)/crews/_components/task-dispute-control", () => ({
  TaskDisputeControl: () => null,
}));
