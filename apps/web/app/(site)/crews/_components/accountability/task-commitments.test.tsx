import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TaskCommitments } from "./task-commitments";
import type { CrewTaskDTO } from "../../_hooks/types";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
const state = vi.hoisted(() => ({
  user: "alice",
  mutate: vi.fn(),
  error: null as Error | null,
  records: [] as unknown[],
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) =>
    en.crewAccountability[key as keyof typeof en.crewAccountability] ?? key,
}));
vi.mock("../../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("../../_hooks/use-accountability", () => ({
  useTaskCommitments: () => ({
    data: { records: state.records },
    isLoading: false,
    isError: !!state.error,
    error: state.error,
    refetch: vi.fn(),
  }),
  useAccountabilityAction: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let node: HTMLDivElement;
const task = {
  id: "task",
  crewId: "crew",
  version: 3,
  status: "in_progress",
  dueAt: "2099-01-01T12:00:00Z",
  assignees: [{ id: "assignment", userId: "alice" }],
} as CrewTaskDTO;
function mount() {
  node = document.createElement("div");
  root = createRoot(node);
  const render = () => act(() => root.render(<TaskCommitments task={task} canManage={false} />));
  render();
  return render;
}
function fill(value: string) {
  const input = node.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  state.user = "alice";
  state.records = [];
  state.error = null;
  vi.resetAllMocks();
});
it("blocks rapid duplicate acceptance before the mutation hook rerenders", async () => {
  let finish!: () => void;
  state.mutate.mockReturnValue(
    new Promise<void>((r) => {
      finish = r;
    })
  );
  mount();
  const accept = [...node.querySelectorAll("button")].find(
    (b) => b.textContent === en.crewAccountability.accept
  )!;
  act(() => {
    accept.click();
    accept.click();
  });
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(state.mutate).toHaveBeenCalledWith({
    path: "/crew-tasks/task/commitments",
    body: { action: "accept", expectedVersion: 3, reason: "" },
  });
  await act(async () => finish());
});
it("retains the withdrawal explanation after failure and allows retry", async () => {
  state.mutate.mockRejectedValue(new Error("Task changed; refresh"));
  mount();
  fill("Unavailable this week; files are ready.");
  const decline = [...node.querySelectorAll("button")].find(
    (b) => b.textContent === en.crewAccountability.declineTask
  )!;
  expect(decline.disabled).toBe(false);
  await act(async () => decline.click());
  expect(node.querySelector("textarea")?.value).toBe("Unavailable this week; files are ready.");
  expect(node.querySelector('[role="alert"]')?.textContent).toBe("Task changed; refresh");
  state.mutate.mockResolvedValue({});
  await act(async () => decline.click());
  expect(state.mutate).toHaveBeenCalledTimes(2);
});
it("clears drafts and ignores a previous account's delayed error", async () => {
  let reject!: (error: Error) => void;
  state.mutate.mockReturnValue(
    new Promise((_res, rej) => {
      reject = rej;
    })
  );
  const render = mount();
  fill("Private explanation");
  act(() =>
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === en.crewAccountability.declineTask)!
      .click()
  );
  state.user = "bob";
  render();
  await act(async () => reject(new Error("Alice private error")));
  expect(node.textContent).not.toContain("Alice private error");
  expect(node.querySelector("textarea")).toBeNull();
});
it("does not offer commitment actions when records cannot be loaded", () => {
  state.error = new Error("Access revoked");
  mount();
  expect(node.textContent).toContain("Access revoked");
  expect(node.textContent).not.toContain(en.crewAccountability.accept);
});
it("provides the same complete accountability copy in all supported languages", () => {
  expect(Object.keys(cn.crewAccountability).sort()).toEqual(
    Object.keys(en.crewAccountability).sort()
  );
  expect(Object.keys(hk.crewAccountability).sort()).toEqual(
    Object.keys(en.crewAccountability).sort()
  );
});
