import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewComputeFinance } from "./crew-compute-finance";
const h = vi.hoisted(() => ({
  owner: false,
  tasks: [] as { id: string; title: string; number: number }[],
  mutate: vi.fn(),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("../_hooks/use-compute-requests", () => ({
  useComputeRequestAction: () => ({ mutate: h.mutate, isPending: false }),
  useComputeRequests: () => ({
    isPending: false,
    isError: false,
    data: {
      isOwner: h.owner,
      tasks: h.tasks,
      totals: { pending: 50, approved: 100 },
      consumedPoints: "123",
      nextCursor: null,
      items: [
        {
          id: "request",
          taskId: "task",
          taskTitle: "Shot one",
          userId: "creator",
          points: 50,
          reason: "Render shot",
          status: "pending",
          createdAt: "2026-09-28T00:00:00Z",
        },
      ],
    },
  }),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("task")}>
      chooseTask
    </button>
  ),
  NativeSelectOption: () => null,
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.owner = false;
  h.tasks = [];
  h.mutate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<CrewComputeFinance crewId="crew" crewName="Film Crew" />));
}
it("shows recorded consumption and requires an assigned task", async () => {
  await render();
  expect(host.textContent).toContain("USD 1.23");
  expect(host.textContent).toContain("noTasks");
  expect(host.querySelector("form")).toBeNull();
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "approve")
  ).toBe(false);
});
it("does not expose approval or rejection even to the Crew owner", async () => {
  h.owner = true;
  await render();
  const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
  expect(labels).not.toContain("approve");
  expect(labels).not.toContain("reject");
  expect(host.textContent).not.toContain("decisionNote");
  expect(h.mutate).not.toHaveBeenCalled();
});
it("keeps the submit key stable across retries until details change", async () => {
  h.tasks = [{ id: "task", title: "Shot one", number: 1 }];
  await render();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "chooseTask")!
      .click();
  });
  await act(async () => {
    const input = host.querySelector('input[type="number"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "50");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const textarea = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      "Render shot"
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await act(async () => {
    submit();
  });
  await act(async () => {
    submit();
  });
  expect(h.mutate).toHaveBeenCalledTimes(2);
  expect(h.mutate.mock.calls[0][0]).toEqual(h.mutate.mock.calls[1][0]);
  expect(h.mutate.mock.calls[0][0]).toMatchObject({
    taskId: "task",
    points: 50,
    reason: "Render shot",
  });
});
