import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskDeliverySession } from "./use-task-delivery-session";
import { TaskDeliveryManagement } from "./task-delivery-management";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  commitments: vi.fn(),
  catalog: vi.fn(),
  template: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("./task-commitment-api", () => ({ fetchTaskCommitments: h.commitments }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-delivery-management-api", () => ({
  fetchDeliveryCatalog: h.catalog,
  setDeliveryTemplate: h.save,
}));
vi.mock("./task-delivery-api", () => ({
  fetchTaskDeliveryTemplate: h.template,
  deliveryPrice: (v: string) => v,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const task = {
  id: "task",
  crewId: "crew",
  version: 7,
  status: "open",
  submissions: [],
} as unknown as TaskDetail;
const row = {
  id: "category",
  version: 3,
  definition: { name: "Film", description: "Master file", fields: [], prices: [] },
};
function TaskPage({ value }: { value: TaskDetail }) {
  const session = useTaskDeliverySession(value.id, 1, h.refresh);
  return (
    <TaskDeliveryManagement
      key={value.version}
      session={session}
      task={value}
      userId="1"
      generation={1}
      onRefresh={h.refresh}
    />
  );
}
const render = (value = task) => act(async () => root.render(<TaskPage value={value} />));
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
const click = async (text: string) =>
  act(async () => {
    const b = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent?.replace(/^✓ /, "") === text
    );
    expect(b).toBeTruthy();
    b!.click();
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.commitments.mockResolvedValue([]);
  h.access.mockResolvedValue({ canManage: true });
  h.catalog.mockResolvedValue({ items: [row], nextCursor: null });
  h.template.mockResolvedValue(null);
  h.save.mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads only for managers and saves the selected category at the captured version", async () => {
  await render();
  await click("taskDelivery.manage");
  await click("Film · taskDelivery.version 3");
  await click("taskDelivery.saveTemplate");
  expect(h.save).toHaveBeenCalledWith(
    "task",
    7,
    { id: "category", version: 3 },
    1,
    expect.any(AbortSignal)
  );
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("requires refresh after an uncertain save and prevents duplicate writes", async () => {
  h.save.mockRejectedValue(Error("Connection lost"));
  await render();
  await click("taskDelivery.manage");
  await click("taskDelivery.withoutTemplate");
  await click("taskDelivery.saveTemplate");
  await click("taskDelivery.saveTemplate");
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Connection lost");
  await click("thread.refresh");
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("does not offer mutation on locked tasks or to viewers", async () => {
  await render({ ...task, status: "submitted" });
  expect(h.access).not.toHaveBeenCalled();
  h.access.mockResolvedValue({ canManage: false });
  await render();
  expect(host.textContent).not.toContain("taskDelivery.manage");
  expect(h.catalog).not.toHaveBeenCalled();
});
it("loads further pages without discarding the draft selection", async () => {
  h.catalog.mockResolvedValueOnce({ items: [row], nextCursor: "next" }).mockResolvedValueOnce({
    items: [{ ...row, id: "two", definition: { ...row.definition, name: "Audio" } }],
    nextCursor: null,
  });
  await render();
  await click("taskDelivery.manage");
  await click("Film · taskDelivery.version 3");
  await click("taskDelivery.moreCategories");
  expect(h.catalog).toHaveBeenLastCalledWith("crew", expect.any(AbortSignal), "next");
  await click("taskDelivery.saveTemplate");
  expect(h.save.mock.calls[0][2]).toEqual({ id: "category", version: 3 });
});

it.each(["accepted", "withdrawn", "at_risk"])(
  "locks the template for historical accepted commitments: %s",
  async (status) => {
    h.commitments.mockResolvedValue([
      {
        status,
        acceptedAt: "2026-09-29T00:00:00Z",
        currentAssignment: false,
        releasedAt: "2026-09-30T00:00:00Z",
      },
    ]);
    await render();
    expect(host.textContent).toContain("taskDelivery.requirementsLocked");
    expect(host.textContent).not.toContain("taskDelivery.manage");
    expect(h.catalog).not.toHaveBeenCalled();
  }
);
it("fails closed when commitment history cannot be loaded", async () => {
  h.commitments.mockRejectedValue(Error("Commitment history unavailable"));
  await render();
  expect(host.textContent).toContain("Commitment history unavailable");
  expect(host.textContent).not.toContain("taskDelivery.manage");
});
it("allows an unaccepted withdrawal without implying an accepted commitment", async () => {
  h.commitments.mockResolvedValue([{ status: "withdrawn", acceptedAt: null }]);
  await render();
  expect(host.textContent).toContain("taskDelivery.manage");
});

it("retains a selected template across task refresh and requires explicit latest-version review", async () => {
  await render();
  await click("taskDelivery.manage");
  await click("Film · taskDelivery.version 3");
  h.template.mockResolvedValue({
    categoryId: "server",
    version: 2,
    definition: { ...row.definition, name: "Server choice" },
  });
  await render({ ...task, version: 8 });
  expect(host.textContent).toContain("✓ Film");
  expect(host.textContent).toContain("Server choice");
  expect(button("taskDelivery.saveTemplate").disabled).toBe(true);
  await click("taskBrief.reviewLatest");
  await click("taskDelivery.saveTemplate");
  expect(h.save).toHaveBeenCalledWith(
    "task",
    8,
    { id: "category", version: 3 },
    1,
    expect.any(AbortSignal)
  );
});
it("keeps a pending save alive and locked through panel refresh", async () => {
  let reject!: (error: Error) => void;
  h.save.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    })
  );
  await render();
  await click("taskDelivery.manage");
  await click("Film · taskDelivery.version 3");
  await click("taskDelivery.saveTemplate");
  const signal = h.save.mock.calls[0][4] as AbortSignal;
  await render({ ...task, version: 8 });
  expect(signal.aborted).toBe(false);
  expect(button("taskDelivery.saveTemplate").disabled).toBe(true);
  expect(button("common.cancel").disabled).toBe(true);
  await act(async () => reject(new Error("Conflict")));
  expect(host.textContent).toContain("✓ Film");
  expect(host.textContent).toContain("Conflict");
  await click("taskBrief.reviewLatest");
  expect(button("taskDelivery.saveTemplate").disabled).toBe(false);
  expect(h.save).toHaveBeenCalledOnce();
});
it("rechecks accepted commitments after refresh before showing retained edits", async () => {
  await render();
  await click("taskDelivery.manage");
  await click("Film · taskDelivery.version 3");
  h.commitments.mockResolvedValue([{ acceptedAt: "2026-10-03T00:00:00Z" }]);
  await render({ ...task, version: 8 });
  expect(host.textContent).toContain("taskDelivery.requirementsLocked");
  expect(button("taskDelivery.saveTemplate")).toBeUndefined();
  expect(h.save).not.toHaveBeenCalled();
});
