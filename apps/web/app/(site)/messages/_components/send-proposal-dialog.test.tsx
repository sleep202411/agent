// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SendProposalDialog } from "./send-proposal-dialog";
const mocks = vi.hoisted(() => ({
  account: "alice",
  cell: "com",
  send: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: mocks.account } }),
}));
vi.mock("@/src/lib/region/cell", () => ({
  get CURRENT_CELL() {
    return mocks.cell;
  },
}));
vi.mock("@/src/env", () => ({
  env: { BANNER_BASE_URL: "https://international.oss-ap-southeast-1.aliyuncs.com" },
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/app/(site)/creators/_hooks/use-conversations", async (original) => ({
  ...(await original<typeof import("@/app/(site)/creators/_hooks/use-conversations")>()),
  useSendProposal: (id: string) => ({
    mutateAsync: (body: unknown) => mocks.send(id, body),
    isPending: false,
  }),
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogBody: Wrap,
    DialogContent: Wrap,
    DialogDescription: Wrap,
    DialogFooter: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
  };
});
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    value,
    onChange,
    children,
  }: {
    value: string;
    onChange: (v: string) => void;
    children: ReactNode;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Test double for the theme-controlled NativeSelect, not product markup.
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
let root: Root, container: HTMLDivElement;
const close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "alice";
  mocks.cell = "com";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (id = "chat-a", open = true) =>
  root.render(<SendProposalDialog open={open} onOpenChange={close} conversationId={id} />);
const send = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "proposalSend"
  )!;
async function fill(index: number, value: string) {
  await act(async () => {
    const input = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[index]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["com", "cn"])("uses the configured %s cell despite the media hostname", async (cell) => {
  mocks.cell = cell;
  await act(async () => render());
  const currency = container.querySelectorAll("select")[1]!;
  expect(currency.value).toBe(cell === "cn" ? "CNY" : "USD");
  expect([...currency.options].map((o) => o.value)).toContain(cell === "cn" ? "CNY" : "SGD");
  expect(currency.options.length).toBe(cell === "cn" ? 1 : 9);
});
it("requires an explicit price while preserving intentional free proposals", async () => {
  mocks.send.mockResolvedValue({});
  await act(async () => render());
  expect(send().disabled).toBe(true);
  await fill(0, "100000001");
  expect(send().disabled).toBe(true);
  await fill(0, "0");
  await act(async () => send().click());
  expect(mocks.send).toHaveBeenCalledWith(
    "chat-a",
    expect.objectContaining({ price: 0, currency: "USD" })
  );
});
it.each([
  [1, ""],
  [1, "0"],
  [1, "366"],
  [1, "1.5"],
  [2, ""],
  [2, "-2"],
  [2, "201"],
  [2, "1.5"],
] as const)("keeps invalid numeric field %s=%s for correction", async (index, value) => {
  await act(async () => render());
  await fill(0, "10");
  await fill(index, value);
  await act(async () => send().click());
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("proposalNumberInvalid");
  expect(container.querySelectorAll<HTMLInputElement>('input[type="number"]')[index]!.value).toBe(
    value
  );
  await fill(index, "2");
  mocks.send.mockResolvedValue({});
  await act(async () => send().click());
  expect(mocks.send).toHaveBeenCalledOnce();
});
it.each(["account", "conversation", "close", "unmount", "active"])(
  "owns duplicate proposals and %s completion",
  async (mode) => {
    let finish!: (value: unknown) => void;
    mocks.send.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => render());
    await fill(0, "10");
    await act(async () => {
      send().click();
      send().click();
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    await act(async () => {
      if (mode === "account") {
        mocks.account = "bob";
        render();
      }
      if (mode === "conversation") render("chat-b");
      if (mode === "close") render("chat-a", false);
      if (mode === "unmount") root.render(null);
    });
    await act(async () => finish({}));
    expect(mocks.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(close).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    if (mode === "account" || mode === "conversation")
      expect(container.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("");
  }
);
it.each([false, true])(
  "retains active failure retry and suppresses abandoned errors=%s",
  async (abandoned) => {
    let reject!: (e: Error) => void;
    mocks.send.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      })
    );
    await act(async () => render());
    await fill(0, "10");
    await act(async () => send().click());
    if (abandoned)
      await act(async () => {
        mocks.account = "bob";
        render();
      });
    await act(async () => reject(new Error("Response unavailable")));
    expect(mocks.error).toHaveBeenCalledTimes(abandoned ? 0 : 1);
    if (!abandoned) {
      mocks.send.mockResolvedValue({});
      await act(async () => send().click());
      expect(mocks.send).toHaveBeenCalledTimes(2);
    }
  }
);

it("reuses proposal identity after failure and replaces it for edited terms", async () => {
  mocks.send.mockRejectedValue(new Error("Response lost"));
  await act(async () => render());
  await fill(0, "10");
  await act(async () => send().click());
  await act(async () => send().click());
  const original = mocks.send.mock.calls[0]![1].clientKey;
  expect(mocks.send.mock.calls[1]![1].clientKey).toBe(original);
  await fill(0, "11");
  await act(async () => send().click());
  expect(mocks.send.mock.calls[2]![1].clientKey).not.toBe(original);
});
it.each(["reopen", "success"])("starts a fresh proposal intent after %s", async (mode) => {
  mocks.send.mockResolvedValue({});
  await act(async () => render());
  await fill(0, "10");
  await act(async () => send().click());
  const original = mocks.send.mock.calls[0]![1].clientKey;
  if (mode === "reopen") {
    await act(async () => render("chat-a", false));
    await act(async () => render());
    await fill(0, "10");
  }
  await act(async () => send().click());
  expect(mocks.send.mock.calls[1]![1].clientKey).not.toBe(original);
});
