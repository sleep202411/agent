import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreateCrewJobDialog } from "./create-crew-job-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  save: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
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
vi.mock("@/components/ui/tag-input", () => ({ TagInput: () => null }));
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
