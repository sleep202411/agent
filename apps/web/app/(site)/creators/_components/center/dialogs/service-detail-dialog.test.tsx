// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ServiceDetailDialog } from "./service-detail-dialog";
const mock = vi.hoisted(() => ({ error: null as Error | null, fetching: false, refetch: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/creators/_hooks/use-creator-services", () => ({
  useCreatorService: () => ({
    data: { id: "service", title: "Old offer", summary: "Old terms", category: "other" },
    error: mock.error,
    isFetching: mock.fetching,
    isLoading: false,
    refetch: mock.refetch,
  }),
}));
vi.mock("./service-detail-sections", () => ({
  ServiceDetailSections: () => <div>Package terms</div>,
}));
vi.mock("./contact-creator-dialog", () => ({
  ContactCreatorDialog: ({ open }: { open: boolean }) => (open ? <div>Contact form</div> : null),
}));
vi.mock("./start-request-dialog", () => ({
  StartRequestDialog: ({ open }: { open: boolean }) => (open ? <div>Order form</div> : null),
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogContent: Wrap,
    DialogBody: Wrap,
    DialogFooter: Wrap,
    DialogHero: ({ title }: { title: string }) => <h2>{title}</h2>,
  };
});
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () => root.render(<ServiceDetailDialog serviceId="service" onOpenChange={() => {}} />));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.error = null;
  mock.fetching = false;
  mock.refetch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("removes stale terms, disables actions and closes nested flows when detail access fails", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "detailStartRequest")!
      .click()
  );
  expect(host.textContent).toContain("Order form");
  mock.error = new Error("Service no longer available");
  await render();
  expect(host.textContent).not.toContain("Package terms");
  expect(host.textContent).not.toContain("Old offer");
  expect(host.textContent).not.toContain("Order form");
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Service no longer available");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "detailStartRequest")!
      .disabled
  ).toBe(true);
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "retryLoad")!.click()
  );
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it("withholds stale detail while revalidating it", async () => {
  mock.fetching = true;
  await render();
  expect(host.textContent).not.toContain("Package terms");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "detailMessageCreator")!
      .disabled
  ).toBe(true);
});

it.each(["detailStartRequest", "detailMessageCreator"])(
  "keeps the %s draft mounted during background revalidation",
  async (action) => {
    await render();
    await act(async () =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === action)!.click()
    );
    const label = action === "detailStartRequest" ? "Order form" : "Contact form";
    expect(host.textContent).toContain(label);
    mock.fetching = true;
    await render();
    expect(host.textContent).toContain(label);
    mock.fetching = false;
    await render();
    expect(host.textContent).toContain(label);
  }
);
