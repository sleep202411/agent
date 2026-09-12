import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskProjectDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { ProjectSettingsDialog } from "./task-project-settings";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  account: "alice",
  rows: false,
  name: "Original",
  updatedAt: "2026-09-01T00:00:00.000Z",
  create: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () =>
  Object.fromEntries(
    [
      "useCreateCrewTaskCycle",
      "useCreateCrewTaskField",
      "useCreateCrewTaskLabel",
      "useDeleteCrewTaskCycle",
      "useDeleteCrewTaskField",
      "useDeleteCrewTaskLabel",
      "useDeleteCrewTaskWorkflowState",
      "useReorderCrewTaskWorkflowStates",
      "useUpdateCrewTaskCycle",
      "useUpdateCrewTaskField",
      "useUpdateCrewTaskLabel",
      "useUpdateCrewTaskWorkflowState",
    ].map((name) => [name, () => ({ mutateAsync: state.create, isPending: false })])
  )
);
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  ...Object.fromEntries(
    [
      "DialogBody",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogTitle",
    ].map((name) => [name, ({ children }: { children: ReactNode }) => <div>{children}</div>])
  ),
}));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
async function render(open = true, crewId = "crew") {
  await act(async () =>
    root.render(
      <ProjectSettingsDialog
        crewId={crewId}
        open={open}
        onOpenChange={vi.fn()}
        onEditWorkflowState={vi.fn()}
        project={
          {
            workflowStates: [],
            cycles: state.rows
              ? [
                  {
                    id: "cycle",
                    name: state.name,
                    goal: "Goal",
                    status: "planned",
                    number: 1,
                    startAt: "2026-09-01T00:00:00.000Z",
                    endAt: "2026-09-10T00:00:00.000Z",
                    updatedAt: state.updatedAt,
                  },
                ]
              : [],
            labels: state.rows
              ? [
                  {
                    id: "label",
                    name: state.name,
                    description: "Description",
                    color: "#ffffff",
                    updatedAt: state.updatedAt,
                  },
                ]
              : [],
            fields: state.rows
              ? [
                  {
                    id: "field",
                    name: state.name,
                    description: "Description",
                    type: "text",
                    required: false,
                    options: [],
                    updatedAt: state.updatedAt,
                  },
                ]
              : [],
          } as unknown as CrewTaskProjectDTO
        }
      />
    )
  );
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith(text)
  )!;
}
async function fill(placeholder: string, text: string) {
  await act(async () => {
    const input = container.querySelector(`input[placeholder="${placeholder}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.account = "alice";
  state.rows = false;
  state.name = "Original";
  state.updatedAt = "2026-09-01T00:00:00.000Z";
});
it.each(["labels", "customFields"])(
  "guards duplicate %s creation and allows retry",
  async (section) => {
    const pending = deferred();
    state.create.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    await render();
    await act(async () => button(section).click());
    const placeholder = section === "labels" ? "labelName" : "customFieldName";
    const add = section === "labels" ? "addLabel" : "addCustomField";
    await fill(placeholder, "Original");
    await act(async () => {
      button(add).click();
      button(add).click();
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(`input[placeholder="${placeholder}"]`)!.matches(":disabled")
    ).toBe(true);
    await act(async () => pending.reject(new Error("Create failed")));
    expect(
      (container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement).value
    ).toBe("Original");
    await act(async () => button(add).click());
    expect(state.create).toHaveBeenCalledTimes(2);
  }
);
it.each(["close", "account", "crew", "section"])(
  "drops label creation results after %s changes",
  async (change) => {
    const pending = deferred();
    state.create.mockReturnValue(pending.promise);
    await render();
    await act(async () => button("labels").click());
    await fill("labelName", "Old");
    await act(async () => button("addLabel").click());
    if (change === "close") {
      await render(false);
      await render();
    } else if (change === "account") {
      state.account = "bob";
      await render();
    } else if (change === "crew") await render(true, "other");
    else await act(async () => button("cycles").click());
    await act(async () => button("labels").click());
    expect(
      (container.querySelector('input[placeholder="labelName"]') as HTMLInputElement).value
    ).toBe("");
    await fill("labelName", "New");
    await act(async () => pending.resolve());
    expect(state.success).not.toHaveBeenCalled();
    expect(
      (container.querySelector('input[placeholder="labelName"]') as HTMLInputElement).value
    ).toBe("New");
  }
);
it("suppresses late settings errors after closing", async () => {
  const pending = deferred();
  state.create.mockReturnValue(pending.promise);
  await render();
  await act(async () => button("labels").click());
  await fill("labelName", "Old");
  await act(async () => button("addLabel").click());
  await render(false);
  await act(async () => pending.reject(new Error("old failure")));
  expect(state.error).not.toHaveBeenCalled();
});

async function startEdit(section: string) {
  await act(async () => button(section).click());
  await act(async () =>
    (container.querySelector('[aria-label="edit"]') as HTMLButtonElement).click()
  );
}
it.each(["cycles", "labels", "customFields"])(
  "retains the original %s edit timestamp during refresh",
  async (section) => {
    state.rows = true;
    state.create.mockResolvedValue(undefined);
    await render();
    await startEdit(section);
    state.updatedAt = "2026-09-02T00:00:00.000Z";
    state.name = "Collaborator";
    await render();
    await act(async () => button("save").click());
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
          name: "Original",
        }),
      })
    );
  }
);
it.each(["cycles", "labels", "customFields"])(
  "loads current %s values when editing starts",
  async (section) => {
    state.rows = true;
    await render();
    await act(async () => button(section).click());
    state.name = "Updated";
    state.updatedAt = "2026-09-02T00:00:00.000Z";
    await render();
    await act(async () =>
      (container.querySelector('[aria-label="edit"]') as HTMLButtonElement).click()
    );
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.some((input) => input.value === "Updated")).toBe(true);
  }
);
