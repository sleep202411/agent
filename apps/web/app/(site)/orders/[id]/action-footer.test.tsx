// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { OrderDTO, OrderStatus } from "@repo/shared/order";
import { ActionFooter } from "./action-footer";
const mocks = vi.hoisted(() => ({
  account: "alice",
  command: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: mocks.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/app/(site)/creators/_hooks/use-orders", () => {
  const useAction = () => ({ mutateAsync: mocks.command, isPending: false });
  return {
    useAcceptOrder: useAction,
    useDeclineOrder: useAction,
    useDeliverOrder: useAction,
    useAcceptDelivery: useAction,
    useRequestRevision: useAction,
    useCancelOrder: useAction,
  };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "alice";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const actions = [
  { key: "accept", role: "creator", status: "pending_creator" },
  { key: "deliver", role: "creator", status: "in_progress" },
  { key: "acceptDelivery", role: "buyer", status: "delivered" },
  { key: "decline", role: "creator", status: "pending_creator", reason: "decline" },
  { key: "cancel", role: "buyer", status: "in_progress", reason: "cancel" },
  { key: "requestRevision", role: "buyer", status: "delivered", reason: "request_revision" },
] satisfies Array<{ key: string; role: "buyer" | "creator"; status: OrderStatus; reason?: string }>;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text
  )!;
const render = (action: (typeof actions)[number], id = "order-1") =>
  root.render(
    <ActionFooter order={{ id, status: action.status } as OrderDTO} role={action.role} />
  );
async function prepare(action: (typeof actions)[number]) {
  if (!action.reason) return button(`action.${action.key}`);
  await act(async () => button(`action.${action.key}`).click());
  await act(async () => {
    const input = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Please revise"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return button(`reason.${action.reason}.confirm`);
}
it.each(actions)("admits $key once and retries active failures", async (action) => {
  let reject!: (error: Error) => void;
  mocks.command.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  await act(async () => render(action));
  const submit = await prepare(action);
  await act(async () => {
    submit.click();
    submit.click();
  });
  expect(mocks.command).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Try again")));
  expect(mocks.error).toHaveBeenCalledWith("Try again");
  mocks.command.mockResolvedValue(undefined);
  await act(async () => submit.click());
  expect(mocks.command).toHaveBeenCalledTimes(2);
  expect(mocks.success).toHaveBeenCalledOnce();
});
for (const mode of ["account", "order", "unmount"] as const) {
  it.each([actions[0]!, actions[3]!])(
    `suppresses $key completion after ${mode} replacement`,
    async (action) => {
      let finish!: () => void;
      mocks.command.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      );
      await act(async () => render(action));
      const submit = await prepare(action);
      await act(async () => submit.click());
      await act(async () => {
        if (mode === "account") {
          mocks.account = "bob";
          render(action);
        } else if (mode === "order") render(action, "order-2");
        else root.render(null);
      });
      await act(async () => finish());
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
      expect(document.querySelector("textarea")).toBeNull();
    }
  );
}
it("suppresses a failed abandoned action", async () => {
  let reject!: (error: Error) => void;
  mocks.command.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  await act(async () => render(actions[0]!));
  await act(async () => button("action.accept").click());
  await act(async () => {
    mocks.account = "bob";
    render(actions[0]!);
  });
  await act(async () => reject(new Error("Old error")));
  expect(mocks.error).not.toHaveBeenCalled();
});
it.each(actions.filter((action) => action.reason))(
  "uses the server's reason limit for $key",
  async (action) => {
    await act(async () => render(action));
    await prepare(action);
    expect(document.querySelector("textarea")?.maxLength).toBe(
      action.reason === "request_revision" ? 2000 : 500
    );
  }
);
