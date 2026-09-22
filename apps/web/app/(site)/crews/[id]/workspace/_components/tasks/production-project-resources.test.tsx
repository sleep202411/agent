import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionProjectResources } from "./production-project-resources";
const state = vi.hoisted(() => ({
  next: vi.fn(),
  hasNextPage: true,
  isFetching: false,
  create: vi.fn(),
  error: null as Error | null,
  items: [{ id: "file", name: "Storyboard" }],
  refetch: vi.fn(),
  nextError: false,
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useCreateCrewProductionResource: () => ({ mutateAsync: state.create }),
  useDeleteCrewProductionResource: () => ({}),
}));
vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets", () => ({
  useCrewAssets: () => ({
    data: { items: state.items },
    error: state.error,
    isError: Boolean(state.error),
    isFetchNextPageError: state.nextError,
    refetch: state.refetch,
    hasNextPage: state.hasNextPage,
    isFetching: state.isFetching,
    fetchNextPage: state.next,
  }),
}));
// Keep the production picker and controls; remove portal/animation mechanics.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => children,
  DialogContent: ({ children }: { children: React.ReactNode }) => children,
  DialogBody: ({ children }: { children: React.ReactNode }) => children,
  DialogFooter: ({ children }: { children: React.ReactNode }) => children,
  DialogTitle: ({ children }: { children: React.ReactNode }) => children,
  DialogClose: ({ children }: { children: React.ReactNode }) => children,
}));
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.error = null;
  state.items = [{ id: "file", name: "Storyboard" }];
  state.nextError = false;
  state.hasNextPage = true;
  state.isFetching = false;
  state.next.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <ProductionProjectResources
        crewId="crew"
        overview={{ resources: [], capabilities: { manage: true } } as never}
      />
    )
  );
}
async function enter(value: string) {
  await act(async () => {
    const input = host.querySelector('input[placeholder="https://"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
it("retains the entered URL after a failed creation", async () => {
  state.create.mockRejectedValueOnce(new Error("Offline"));
  await enter("https://example.com/storyboard");
  await submit();
  expect((host.querySelector('input[placeholder="https://"]') as HTMLInputElement).value).toBe(
    "https://example.com/storyboard"
  );
});
it("clears the submitted URL after successful creation", async () => {
  state.create.mockResolvedValueOnce({});
  await enter("https://example.com/storyboard");
  await submit();
  expect((host.querySelector('input[placeholder="https://"]') as HTMLInputElement).value).toBe("");
});

it("does not clear a newer draft when the previous creation succeeds", async () => {
  let finish!: () => void;
  state.create.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  await enter("https://example.com/first");
  await submit();
  await enter("https://example.com/second");
  await act(async () => finish());
  expect((host.querySelector('input[placeholder="https://"]') as HTMLInputElement).value).toBe(
    "https://example.com/second"
  );
});

async function assetMode() {
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "resources.kind.asset")!
      .click();
  });
}
const more = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "loadMore");
it("offers the next asset page without cancelling an ongoing request", async () => {
  await assetMode();
  expect(more()).toBeTruthy();
  await act(async () => more()!.click());
  expect(state.next).toHaveBeenCalledWith({ cancelRefetch: false });
});
it("disables continuation while fetching", async () => {
  await assetMode();
  state.isFetching = true;
  await render();
  expect(more()?.disabled).toBe(true);
});
it("hides continuation once all assets are loaded", async () => {
  await assetMode();
  state.hasNextPage = false;
  await render();
  expect(more()).toBeUndefined();
});

it("shows a failed initial asset load as an error and retries it", async () => {
  state.items = [];
  state.error = new Error("Assets unavailable");
  state.hasNextPage = false;
  await render();
  await assetMode();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Assets unavailable");
  expect(host.textContent).not.toContain("resources.noAssets");
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click();
  });
  expect(state.refetch).toHaveBeenCalledTimes(1);
});
it("preserves loaded assets and retries the failed next page", async () => {
  state.error = new Error("Page failed");
  state.nextError = true;
  await render();
  await assetMode();
  expect(host.textContent).toContain("Storyboard");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Page failed");
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click();
  });
  expect(state.next).toHaveBeenCalledWith({ cancelRefetch: false });
  expect(state.refetch).not.toHaveBeenCalled();
});
