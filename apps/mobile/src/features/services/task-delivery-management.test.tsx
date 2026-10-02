import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskDeliveryManagement } from "./task-delivery-management";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  access: vi.fn(),
  catalog: vi.fn(),
  template: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
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
const render = (value = task) =>
  act(async () =>
    root.render(
      <TaskDeliveryManagement task={value} userId="1" generation={1} onRefresh={h.refresh} />
    )
  );
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
  await click("taskDelivery.noTemplate");
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
