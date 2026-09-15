// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ContactCreatorDialog } from "./contact-creator-dialog";
const mocks = vi.hoisted(() => ({
  account: "alice",
  send: vi.fn(),
  push: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: mocks.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/app/(site)/creators/_hooks/use-conversations", async (original) => ({
  ...(await original<typeof import("@/app/(site)/creators/_hooks/use-conversations")>()),
  useOpenConversation: () => ({ mutateAsync: mocks.send, isPending: false }),
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
let root: Root, container: HTMLDivElement;
const close = vi.fn();
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
const render = (id = "service-1", open = true) =>
  root.render(
    <ContactCreatorDialog
      service={{ id, title: "Service", category: "other", coverPath: "" }}
      open={open}
      onOpenChange={close}
    />
  );
const send = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "send"
  )!;
async function fill() {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Alice draft"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["account", "service", "closed", "unmount", "active"])(
  "owns rapid contact submission and %s completion",
  async (mode) => {
    let finish!: (value: { conversation: { id: string } }) => void;
    mocks.send.mockReturnValueOnce(
      new Promise<{ conversation: { id: string } }>((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => render());
    await fill();
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
      if (mode === "service") render("service-2");
      if (mode === "closed") render("service-1", false);
      if (mode === "unmount") root.render(null);
    });
    await act(async () => finish({ conversation: { id: "conversation-1" } }));
    expect(mocks.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(close).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    if (mode === "active") {
      mocks.success.mock.calls[0]![1].action.onClick();
      expect(mocks.push).toHaveBeenCalledWith("/en-US/messages/conversation-1");
    } else if (mode === "account" || mode === "service") {
      expect(container.querySelector("textarea")!.value).toBe("");
    }
  }
);
it.each([false, true])("handles contact failure abandoned=%s", async (abandoned) => {
  let reject!: (error: Error) => void;
  mocks.send.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  await act(async () => render());
  await fill();
  await act(async () => send().click());
  if (abandoned)
    await act(async () => {
      mocks.account = "bob";
      render();
    });
  await act(async () => reject(new Error("Unavailable")));
  expect(mocks.error).toHaveBeenCalledTimes(abandoned ? 0 : 1);
  if (!abandoned) {
    expect(container.querySelector("textarea")!.value).toBe("Alice draft");
    mocks.send.mockResolvedValue({ conversation: { id: "conversation-1" } });
    await act(async () => send().click());
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.success).toHaveBeenCalledOnce();
  }
});
