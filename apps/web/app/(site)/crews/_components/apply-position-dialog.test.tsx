import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplyPositionDialog } from "./apply-position-dialog";
const state = vi.hoisted(() => ({
  account: "alice",
  apply: vi.fn(),
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
  CrewApiError: class extends Error {},
  useApplyToPosition: () => ({ mutate: state.apply, isPending: false }),
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
async function render(open = true, crew = "crew", position = "position") {
  await act(async () =>
    root.render(
      <ApplyPositionDialog
        open={open}
        onOpenChange={state.close}
        crewId={crew}
        positionId={position}
        positionLabel="Director"
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
async function submit() {
  await act(async () => {
    const button = [...container.querySelectorAll("button")].at(-1)!;
    button.click();
    button.click();
  });
}
it("blocks duplicate applications and preserves failed drafts for retry", async () => {
  await render();
  await type("My application");
  await submit();
  expect(state.apply).toHaveBeenCalledTimes(1);
  const handlers = state.apply.mock.calls[0]?.[1];
  await act(async () => {
    handlers.onError(new Error("Specific failure"));
    handlers.onSettled?.();
  });
  expect(state.error).toHaveBeenCalledWith("Specific failure");
  expect(container.querySelector("textarea")?.value).toBe("My application");
  await submit();
  expect(state.apply).toHaveBeenCalledTimes(2);
});
it.each(["account", "crew", "position", "close"])(
  "resets drafts and ignores late application results after %s changes",
  async (change) => {
    await render();
    await type("Old draft");
    await submit();
    const handlers = state.apply.mock.calls[0]?.[1];
    if (change === "account") state.account = "bob";
    if (change === "close") await render(false);
    await render(
      true,
      change === "crew" ? "next-crew" : "crew",
      change === "position" ? "next-position" : "position"
    );
    expect(container.querySelector("textarea")?.value).toBe("");
    await act(async () => {
      handlers.onSuccess({});
      handlers.onSettled?.();
    });
    expect(state.close).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  }
);

async function numberInput(index: number, value: string) {
  await act(async () => {
    const input = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("preserves fractional compensation instead of truncating it", async () => {
  await render();
  await type("Application");
  await numberInput(0, "1250.50");
  await submit();
  expect(state.apply.mock.calls[0]?.[0].expectedCompensation.amount).toBe(1250.5);
});
it.each(["-1", "100000001"])("blocks out-of-range compensation %s", async (value) => {
  await render();
  await type("Application");
  await numberInput(0, value);
  await submit();
  expect(state.apply).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it.each(["1.5", "-1", "81"])("blocks invalid experience %s without truncation", async (value) => {
  await render();
  await type("Application");
  await numberInput(1, value);
  await submit();
  expect(state.apply).not.toHaveBeenCalled();
});
it("accepts zero values and recovers when invalid experience is corrected", async () => {
  await render();
  await type("Application");
  await numberInput(1, "1.5");
  await numberInput(1, "0");
  await numberInput(0, "0");
  await submit();
  expect(state.apply.mock.calls[0]?.[0]).toMatchObject({
    yearsExperience: 0,
    expectedCompensation: { amount: 0 },
  });
});

it("parses exponent notation accepted by number inputs without dropping its exponent", async () => {
  await render();
  await type("Application");
  await numberInput(0, "1e3");
  await numberInput(1, "1e1");
  await submit();
  expect(state.apply.mock.calls[0]?.[0]).toMatchObject({
    expectedCompensation: { amount: 1000 },
    yearsExperience: 10,
  });
});
it("leaves optional compensation and experience unset when blank", async () => {
  await render();
  await type("Application");
  await submit();
  expect(state.apply.mock.calls[0]?.[0]).toMatchObject({
    expectedCompensation: null,
    yearsExperience: null,
  });
});
