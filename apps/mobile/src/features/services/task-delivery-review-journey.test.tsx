import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { TaskSubmit } from "./task-submit";
import { TaskReview } from "./task-review";
import { TaskDelivery } from "./task-delivery";
import { fetchTaskDetail, type TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
  ActivityIndicator: () => <span>loading</span>,
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
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/features/crew-assets/asset-picker", () => ({ CrewAssetPicker: () => null }));
vi.mock("@/features/crew-assets/file-upload", () => ({ AssetFileUpload: () => null }));
vi.mock("./conversation-file", () => ({ ConversationFile: () => null }));
vi.mock("./user-displays", () => ({
  useUserDisplays: () =>
    new Map([
      ["artist", { nickname: "Artist" }],
      ["owner", { nickname: "Director" }],
    ]),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = "11111111-1111-4111-8111-111111111111";
const submissionId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const initial: TaskDetail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Deliver a script",
  canvasHref: "/fizzstudio/projects/script",
  version: 1,
  status: "open",
  revisionLimit: 2,
  revisionRoundsUsed: 0,
  priority: "normal",
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  workflowState: { name: "Open" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [{ id, userId: "artist" }],
  submissions: [],
};
let task: TaskDetail, actor: string, loseReview: boolean;
let root: Root, host: HTMLDivElement;
// Fixture host deliberately uses the actual detail parser and panel sessions.
// Navigation, network, native asset transfer and server authorization are not simulated as proof.
function Journey() {
  const [revision, setRevision] = useState(0);
  const [current, setCurrent] = useState<TaskDetail>();
  useEffect(() => {
    const c = new AbortController();
    void fetchTaskDetail("crew", id, c.signal).then((value) => {
      if (!c.signal.aborted) setCurrent(value);
    });
    return () => c.abort();
  }, [revision]);
  const refresh = () => setRevision((value) => value + 1);
  return current ? (
    <>
      <span>{current.status}</span>
      <TaskDelivery taskId={id} generation={h.generation} submissions={current.submissions} />
      <button onClick={refresh}>read task</button>
      <TaskSubmit task={current} userId={actor} generation={h.generation} onRefresh={refresh} />
      <TaskReview task={current} userId={actor} generation={h.generation} onRefresh={refresh} />
    </>
  ) : null;
}
const render = (user: string) =>
  act(async () => {
    if (actor !== user) h.generation++;
    actor = user;
    root.render(<Journey key={`${user}:${h.generation}`} />);
  });
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);
const click = (label: string) => act(async () => button(label)!.click());
const typeNote = (value: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  task = structuredClone(initial);
  actor = "";
  h.generation = 1;
  loseReview = false;
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === `/crew-tasks/${id}`) return structuredClone(task);
    if (path.endsWith("/members/me"))
      return {
        userId: actor,
        permissions: actor === "owner" ? ["tasks.review"] : ["tasks.submit_assigned"],
      };
    if (path.endsWith("/delivery-template")) return null;
    if (path.endsWith("/assets/folders")) return [];
    throw Error(`Unexpected read: ${path}`);
  });
  vi.mocked(api.post).mockImplementation(async (path, options) => {
    const data = options!.data as Record<string, unknown>;
    if (path.endsWith("/submissions")) {
      expect(actor).toBe("artist");
      expect(["open", "revision_requested"]).toContain(task.status);
      task = {
        ...task,
        status: "submitted",
        version: task.version + 1,
        submissions: [
          {
            id: submissionId(task.submissions.length + 1),
            versionNumber: task.submissions.length + 1,
            submittedByUserId: actor,
            note: data.note as string,
            professionalDelivery: null,
            canvasVersionId: null,
            productionVersionId: null,
            reviewNote: null,
            reviewedByUserId: null,
            reviewedAt: null,
            mergedAt: null,
            createdAt: "2026-10-04T00:00:00Z",
            assets: [],
          },
          ...task.submissions,
        ],
      };
    } else if (path.endsWith("/review")) {
      expect(actor).toBe("owner");
      expect(task.status).toBe("submitted");
      expect(data.expectedSubmissionId).toBe(task.submissions[0]!.id);
      const revision = data.decision === "request_revision";
      task = {
        ...task,
        status: revision ? "revision_requested" : "approved",
        version: task.version + 1,
        revisionRoundsUsed: task.revisionRoundsUsed + (revision ? 1 : 0),
        submissions: task.submissions.map((s, i) =>
          i
            ? s
            : {
                ...s,
                reviewNote: data.note as string,
                reviewedByUserId: actor,
                reviewedAt: "2026-10-04T00:01:00Z",
              }
        ),
      };
      if (loseReview) throw Error("Review response lost");
    } else throw Error(`Unexpected write: ${path}`);
    return structuredClone(task);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("completes submission, revision, resubmission and approval across contributor/owner sessions", async () => {
  await render("artist");
  await typeNote("First script");
  await click("taskSubmit.submitAction");
  expect(host.textContent).toContain("submitted");
  expect(button("taskSubmit.submitAction")).toBeUndefined();
  await render("owner");
  await typeNote("Fix the ending");
  await click("taskReview.requestRevision");
  expect(host.textContent).toContain("revision_requested");
  await render("artist");
  expect(host.textContent).toContain("Fix the ending");
  expect(host.querySelector("input")!.value).toBe("");
  await typeNote("Revised script");
  await click("taskSubmit.submitAction");
  await render("owner");
  expect(host.querySelector("input")!.value).toBe("");
  await click("taskReview.approve");
  await render("artist");
  expect(host.textContent).toContain("approved");
  expect(button("taskSubmit.submitAction")).toBeUndefined();
  expect(task.submissions.map((s) => s.note)).toEqual(["Revised script", "First script"]);
  expect(api.post).toHaveBeenCalledTimes(4);
});
it("recovers a lost approval receipt by reading state without another review write", async () => {
  await render("artist");
  await typeNote("Final script");
  await click("taskSubmit.submitAction");
  await render("owner");
  loseReview = true;
  await click("taskReview.approve");
  expect(host.textContent).toContain("Review response lost");
  expect(button("taskReview.approve")!.disabled).toBe(true);
  await click("thread.refresh");
  expect(host.textContent).toContain("approved");
  expect(button("taskReview.approve")).toBeUndefined();
  await render("artist");
  expect(host.textContent).toContain("approved");
  expect(api.post).toHaveBeenCalledTimes(2);
});
