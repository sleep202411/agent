import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskCustomFields } from "./task-custom-fields";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("./task-custom-fields-api", async (original) => ({
  ...(await original<typeof import("./task-custom-fields-api")>()),
  fetchTaskCustomFields: h.fetch,
}));
vi.mock("./task-custom-field-editor", () => ({ TaskCustomFieldEditing: () => null }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => undefined }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const task: TaskDetail = {
  id: "task",
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Brief",
  version: 4,
  status: "open",
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  workflowState: { name: "Open" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [],
  submissions: [],
};
let host: HTMLDivElement, root: Root;
const rows = [
  {
    field: {
      id: "field",
      crewId: "crew",
      name: "Department",
      required: false,
      type: "single_select",
      options: [{ id: "art", label: "Art" }],
    },
    value: "art",
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue(rows);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = () =>
  act(async () =>
    root.render(<TaskCustomFields task={task} generation={1} userId="1" onRefresh={h.open} />)
  );
it("displays field labels and resolved options", async () => {
  await render();
  expect(host.textContent).toContain("DepartmentArt");
});
it("shows fetch errors and retries without hiding the task", async () => {
  h.fetch.mockRejectedValueOnce(new Error("Offline"));
  await render();
  expect(host.textContent).toContain("Offline");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("DepartmentArt");
});
it("ignores results after account change and aborts on unmount", async () => {
  let finish!: (v: unknown) => void;
  h.fetch.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await render();
  const signal = h.fetch.mock.calls[0]![1] as AbortSignal;
  h.generation = 2;
  await act(async () => finish(rows));
  expect(host.textContent).not.toContain("Department");
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
