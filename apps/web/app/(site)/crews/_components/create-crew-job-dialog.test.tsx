import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreateCrewJobDialog } from "./create-crew-job-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  canLink: true,
  taskError: false,
  brief: "Storyboard requirements",
  reward: null as number | null,
  save: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../_hooks/use-crew-permissions", () => ({
  useCrewPermissions: () => ({ can: () => state.canLink }),
}));
vi.mock("../_hooks/use-tasks", () => ({
  useCrewTask: () => ({
    isSuccess: true,
    isError: state.taskError,
    data: {
      id: "task-one",
      crewId: "crew",
      description: state.brief,
      rewardUsdMinor: state.reward,
    },
  }),
  useCrewTaskOptions: () => ({
    data: [{ id: "task-one", number: 1, title: "Storyboard" }],
    isSuccess: true,
    isError: state.taskError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CURRENCY_SYMBOLS: { USD: "$", CNY: "¥" },
  ZERO_DECIMAL_CURRENCIES: new Set(),
  CrewApiError: class extends Error {},
  useCreatePosition: () => ({ mutate: state.create, isPending: false }),
  useUpdatePosition: () => ({ mutate: state.save, isPending: false }),
  useCrewApplications: () => ({ summary: { pending: 0 } }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-position-label", () => ({
  useTranslatedPresetPositions: () => [{ value: "director", label: "Director" }],
}));
vi.mock("./required-skills-select", () => ({ RequiredSkillsSelect: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Native control stands in for the mocked Select in this interaction test.
    <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Part,
    DialogBody: Part,
    DialogFooter: Part,
    DialogHero: () => null,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  state.canLink = true;
  state.taskError = false;
  state.brief = "Storyboard requirements";
  state.reward = null;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const position = {
  id: "position",
  positionType: "director",
  description: "Original",
  targetCount: 1,
  requiredSkills: [],
  workMode: "remote",
  location: null,
  employmentType: "project_based",
  experienceLevel: "any",
  salary: {
    currency: "USD",
    period: "month",
    minAmount: 10000,
    maxAmount: 20000,
    negotiable: false,
  },
  durationMonths: null,
  revenueSharePercent: null,
  closeDate: null,
} as unknown as import("@/app/(site)/crews/_hooks/use-crew").CrewPositionDTO;
async function render(open = true, crew = "crew", editingPosition = position) {
  await act(async () =>
    root.render(
      <CreateCrewJobDialog
        open={open}
        onOpenChange={state.close}
        crewId={crew}
        editingPosition={editingPosition}
      />
    )
  );
}
async function type(value: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function next() {
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "createJobNext")!
      .click()
  );
}
async function save() {
  await act(async () => {
    const button = [...container.querySelectorAll("button")].at(-1)!;
    button.click();
    button.click();
  });
}
it("preserves unsaved edits when the same position refreshes", async () => {
  await render();
  await type("My changes");
  await render(true, "crew", { ...position, description: "Server refresh" });
  expect(container.querySelector("textarea")?.value).toBe("My changes");
  await next();
  await next();
  await save();
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({
    positionId: "position",
    description: "My changes",
  });
});
it("blocks duplicate saves and retains failed drafts for retry", async () => {
  await render();
  await type("My changes");
  await next();
  await next();
  await save();
  expect(state.save).toHaveBeenCalledTimes(1);
  const handlers = state.save.mock.calls[0]?.[1];
  await act(async () => {
    handlers.onError(new Error("Specific failure"));
    handlers.onSettled?.();
  });
  expect(state.error).toHaveBeenCalledWith("Specific failure");
  await save();
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save.mock.calls[1]?.[0].description).toBe("My changes");
});
it.each(["account", "crew", "position", "close"])(
  "isolates pending edits after %s changes",
  async (change) => {
    await render();
    await type("Old draft");
    await next();
    await next();
    await save();
    const handlers = state.save.mock.calls[0]?.[1];
    if (change === "account") state.account = "bob";
    if (change === "close") await render(false);
    await render(
      true,
      change === "crew" ? "next-crew" : "crew",
      change === "position"
        ? { ...position, id: "next-position", description: "Next position" }
        : position
    );
    expect(container.querySelector("textarea")?.value).toBe(
      change === "position" ? "Next position" : "Original"
    );
    await act(async () => {
      handlers.onSuccess({});
      handlers.onError(new Error("Old failure"));
      handlers.onSettled?.();
    });
    expect(state.close).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
  }
);

it("blocks duplicate creation and ignores completion after closing", async () => {
  await act(async () =>
    root.render(<CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" />)
  );
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "director";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await type("New position");
  await next();
  await next();
  await save();
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.create.mock.calls[0]?.[0]).toMatchObject({
    positionType: "director",
    description: "New position",
  });
  const handlers = state.create.mock.calls[0]?.[1];
  await render(false);
  await render();
  await act(async () => {
    handlers.onSuccess({});
    handlers.onSettled?.();
  });
  expect(state.close).not.toHaveBeenCalled();
});

async function numberInput(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["1.5", "99.9"])("does not advance with fractional headcount %s", async (value) => {
  await render();
  await numberInput('input[max="99"]', value);
  await next();
  expect(container.querySelector('input[max="99"]')).not.toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});
it.each(["1.5", "60.9"])("does not submit fractional duration %s", async (value) => {
  await render();
  await next();
  await next();
  await numberInput('input[max="60"]', value);
  await save();
  expect(state.save).not.toHaveBeenCalled();
  expect(container.textContent).toContain("createJobDurationError");
});
it("preserves the values of exponent-form headcount and duration", async () => {
  await render();
  await numberInput('input[max="99"]', "1e1");
  await next();
  await next();
  await numberInput('input[max="60"]', "2e1");
  await save();
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({ targetCount: 10, durationMonths: 20 });
});
it("allows correcting fractional values and retains optional blank duration", async () => {
  await render();
  await numberInput('input[max="99"]', "1.5");
  await numberInput('input[max="99"]', "2");
  await next();
  await next();
  await numberInput('input[max="60"]', "1.5");
  await numberInput('input[max="60"]', "");
  await save();
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({ targetCount: 2, durationMonths: null });
});

it("blocks fractional headcount when creating a new position too", async () => {
  await act(async () =>
    root.render(<CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" />)
  );
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "director";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await type("New position");
  await numberInput('input[max="99"]', "1.5");
  await next();
  expect(container.querySelector('input[max="99"]')).not.toBeNull();
  expect(container.textContent).toContain("createJobNumberError");
  expect(state.create).not.toHaveBeenCalled();
});

async function createWithTask() {
  await act(async () =>
    root.render(<CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" />)
  );
  await act(async () => {
    const selects = container.querySelectorAll("select");
    for (const [select, value] of [
      [selects[0], "director"],
      [selects[1], "task-one"],
    ] as const) {
      select!.value = value;
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await type("Recruit storyboard creator");
}
it("publishes an explicitly selected task link", async () => {
  await createWithTask();
  await next();
  await next();
  await save();
  expect(state.create.mock.calls[0]?.[0]).toMatchObject({ taskId: "task-one" });
});
it.each(["permission", "read"])("blocks a selected task after %s loss", async (reason) => {
  await createWithTask();
  await next();
  await next();
  if (reason === "permission") state.canLink = false;
  else state.taskError = true;
  await act(async () =>
    root.render(<CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" />)
  );
  await save();
  expect(state.create).not.toHaveBeenCalled();
});
it("does not submit an immutable task link when editing", async () => {
  await render(true, "crew", { ...position, taskId: "existing" });
  await next();
  await next();
  await save();
  expect(state.save.mock.calls[0]?.[0]).not.toHaveProperty("taskId");
});

it("publishes linked recruitment without a visibility or routine refresh control", async () => {
  await createWithTask();
  expect(container.textContent).not.toContain("recruitmentVisibility");
  expect(container.textContent).not.toContain("recruitmentTaskRefresh");
  await next();
  await next();
  await save();
  expect(state.create.mock.calls[0]?.[0]).toMatchObject({
    taskId: "task-one",
    recruitmentVisibility: "public",
  });
});

it("omits recruitment visibility when removing the task link", async () => {
  await createWithTask();
  await act(async () => {
    const task = container.querySelectorAll("select")[1]!;
    task.value = "none";
    task.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await next();
  await next();
  await save();
  expect(state.create.mock.calls[0]?.[0]).not.toHaveProperty("taskId");
  expect(state.create.mock.calls[0]?.[0]).not.toHaveProperty("recruitmentVisibility");
});

async function salaryInput(placeholder: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each([
  ["createJobSalaryMinPlaceholder", "-1"],
  ["createJobSalaryMaxPlaceholder", "-1"],
  ["createJobSalaryMinPlaceholder", "100000001"],
  ["createJobSalaryMaxPlaceholder", "100000001"],
])("blocks an invalid one-sided salary in %s (%s)", async (field, value) => {
  await render();
  await next();
  await next();
  await salaryInput("createJobSalaryMinPlaceholder", "");
  await salaryInput("createJobSalaryMaxPlaceholder", "");
  await salaryInput(field, value);
  await save();
  expect(state.save).not.toHaveBeenCalled();
  expect(container.textContent).toContain("createJobSalaryAmountError");
});
it.each(["0", "100000000", "123.45", ""])(
  "preserves valid one-sided or blank salary %s",
  async (value) => {
    await render();
    await next();
    await next();
    await salaryInput("createJobSalaryMinPlaceholder", value);
    await salaryInput("createJobSalaryMaxPlaceholder", "");
    await save();
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save.mock.calls[0][0].salary).toMatchObject({
      min: value === "" ? null : Number(value),
      max: null,
    });
  }
);
it("allows correcting a rejected amount without losing the rest of the draft", async () => {
  await render();
  await type("Updated role");
  await next();
  await next();
  await salaryInput("createJobSalaryMinPlaceholder", "-10");
  await save();
  expect(state.save).not.toHaveBeenCalled();
  await salaryInput("createJobSalaryMinPlaceholder", "150");
  await save();
  expect(state.save.mock.calls[0][0]).toMatchObject({
    description: "Updated role",
    salary: { min: 150, max: 200 },
  });
});

it("preselects the saved task supplied by the publishing handoff", async () => {
  await act(async () =>
    root.render(
      <CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" initialTaskId="task-one" />
    )
  );
  expect(
    [...container.querySelectorAll("select")].some((select) => select.value === "task-one")
  ).toBe(true);
  expect(state.create).not.toHaveBeenCalled();
});

it("prefills the linked task brief without publishing or overwriting later edits", async () => {
  await act(async () =>
    root.render(
      <CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" initialTaskId="task-one" />
    )
  );
  expect(container.querySelector("textarea")?.value).toBe("Storyboard requirements");
  const copy = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "useTaskBrief"
  )!;
  await act(async () => copy.click());
  expect(container.querySelector("textarea")?.value).toBe("Storyboard requirements");
  expect(copy.disabled).toBe(true);
  expect(state.create).not.toHaveBeenCalled();
});

it("preserves an oversized task brief for editing and blocks advancing the public description", async () => {
  state.brief = "a".repeat(10001);
  await act(async () =>
    root.render(
      <CreateCrewJobDialog open onOpenChange={state.close} crewId="crew" initialTaskId="task-one" />
    )
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "useTaskBrief")!
      .click()
  );
  expect(container.querySelector("textarea")?.value).toHaveLength(10001);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("publicBriefTooLong");
  expect(state.create).not.toHaveBeenCalled();
});

it.each(["monthly", "half_upfront", "on_completion", null] as const)(
  "preserves saved payment timing %s through editing",
  async (paymentTerms) => {
    await render(true, "crew", { ...position, paymentTerms });
    await next();
    await next();
    await save();
    expect(state.save.mock.calls[0][0].paymentTerms).toBe(paymentTerms);
  }
);

it("keeps a linked task’s USD 200 reward in the submitted position", async () => {
  state.reward = 20000;
  await createWithTask();
  await next();
  await next();
  await save();
  expect(state.create.mock.calls[0]?.[0]).toMatchObject({
    taskId: "task-one",
    salary: { currency: "USD", min: 200, max: 200, period: "project" },
  });
});
