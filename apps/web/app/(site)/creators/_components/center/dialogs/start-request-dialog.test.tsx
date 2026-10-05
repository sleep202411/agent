// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { CreatorServiceDTO } from "@repo/shared/creator-service";
import { StartRequestDialog } from "./start-request-dialog";
const mocks = vi.hoisted(() => ({
  account: "alice",
  submit: vi.fn(),
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
vi.mock("@/app/(site)/creators/_hooks/use-orders", async (original) => ({
  ...(await original<typeof import("@/app/(site)/creators/_hooks/use-orders")>()),
  useSubmitOrder: () => ({ mutateAsync: mocks.submit, isPending: false }),
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
const service: CreatorServiceDTO = {
  id: "service-1",
  creatorId: "creator",
  title: "Service",
  summary: "Fixture",
  coverPath: "",
  category: "other",
  tags: [],
  status: "listed",
  publishedAt: null,
  createdAt: "2026-09-15T00:00:00Z",
  updatedAt: "2026-09-15T00:00:00Z",
  version: 1,
  packages: [
    {
      id: "package",
      tier: "basic",
      title: "Basic",
      description: "Fixture",
      price: 10,
      currency: "USD",
      deliveryDays: 1,
      revisions: 1,
      scope: [],
    },
  ],
  requirementQuestions: [
    { id: "question", prompt: "Brief", helpText: "", required: true, displayOrder: 0 },
  ],
};
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
  root.render(<StartRequestDialog service={{ ...service, id }} open={open} onOpenChange={close} />);
const submit = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "startRequestSubmit"
  )!;
async function fill() {
  await act(async () => {
    for (const input of container.querySelectorAll("textarea")) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "Alice draft"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
it.each(["account", "service", "closed", "unmount", "active"])(
  "owns duplicate submission and %s completion",
  async (mode) => {
    let finish!: (value: { id: string }) => void;
    mocks.submit.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => render());
    expect(submit().disabled).toBe(true);
    await fill();
    await act(async () => {
      submit().click();
      submit().click();
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit.mock.calls[0]![0]).toMatchObject({
      serviceId: "service-1",
      answers: [{ questionId: "question", answer: "Alice draft" }],
    });
    await act(async () => {
      if (mode === "account") {
        mocks.account = "bob";
        render();
      }
      if (mode === "service") render("service-2");
      if (mode === "closed") render("service-1", false);
      if (mode === "unmount") root.render(null);
    });
    await act(async () => finish({ id: "order-1" }));
    expect(mocks.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(close).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(mocks.push).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    if (mode === "account" || mode === "service") {
      expect([...container.querySelectorAll("textarea")].map((input) => input.value)).toEqual([
        "",
        "",
      ]);
      await fill();
      mocks.submit.mockResolvedValue({ id: "new-order" });
      await act(async () => submit().click());
      expect(mocks.submit.mock.calls[1]![0].idempotencyKey).not.toBe(
        mocks.submit.mock.calls[0]![0].idempotencyKey
      );
    }
  }
);
it.each([false, true])("handles a failed request with abandoned=%s", async (abandoned) => {
  let reject!: (error: Error) => void;
  mocks.submit.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  await act(async () => render());
  await fill();
  await act(async () => submit().click());
  if (abandoned)
    await act(async () => {
      mocks.account = "bob";
      render();
    });
  await act(async () => reject(new Error("Unavailable")));
  expect(mocks.error).toHaveBeenCalledTimes(abandoned ? 0 : 1);
  if (!abandoned) {
    mocks.submit.mockResolvedValue({ id: "order-1" });
    await act(async () => submit().click());
    expect(mocks.submit.mock.calls[1]![0]).toEqual(mocks.submit.mock.calls[0]![0]);
    expect(mocks.push).toHaveBeenCalledOnce();
  }
});

it("submits the displayed service version and retains it during a failed retry", async () => {
  mocks.submit.mockRejectedValue(new Error("Service changed"));
  await act(async () => render());
  await fill();
  await act(async () => submit().click());
  await act(async () => submit().click());
  expect(mocks.submit.mock.calls[0]![0].expectedServiceVersion).toBe(service.version);
  expect(mocks.submit.mock.calls[1]![0].expectedServiceVersion).toBe(service.version);
  expect(mocks.submit.mock.calls[1]![0].idempotencyKey).toBe(
    mocks.submit.mock.calls[0]![0].idempotencyKey
  );
  expect(close).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("Alice draft");
});

it("preserves the brief while revalidation pauses and resumes submission", async () => {
  await act(async () => render());
  await fill();
  await act(async () =>
    root.render(<StartRequestDialog service={service} open onOpenChange={close} revalidating />)
  );
  expect(submit().disabled).toBe(true);
  await act(async () => submit().click());
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("Alice draft");
  await act(async () => render());
  expect(submit().disabled).toBe(false);
  expect(container.querySelector("textarea")!.value).toBe("Alice draft");
});
