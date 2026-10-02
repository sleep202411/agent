import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SaveOpening } from "./save-opening";
const h = vi.hoisted(() => ({
  user: "alice",
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  login: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: h.login }),
}));
vi.mock("../_hooks/api", () => ({
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    put: (...args: unknown[]) => h.put(...args),
    delete: (...args: unknown[]) => h.remove(...args),
  },
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const render = async () => {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <SaveOpening positionId="job" />
      </QueryClientProvider>
    )
  );
  await settle();
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  h.user = "alice";
  h.get.mockResolvedValue({ saved: false });
  h.put.mockResolvedValue({ saved: true });
  h.remove.mockResolvedValue({ saved: false });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("persists save and removal only after successful replies", async () => {
  await render();
  h.put.mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => host.querySelector("button")!.click());
  await settle();
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Save failed");
  expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
  await act(async () => host.querySelector("button")!.click());
  await settle();
  expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
  await act(async () => host.querySelector("button")!.click());
  await settle();
  expect(h.remove).toHaveBeenCalledWith("/positions/job/saved");
  expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
});
it("never presents another account's delayed saved state", async () => {
  let finish!: (value: { saved: boolean }) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.user = "bob";
  await render();
  await act(async () => finish({ saved: true }));
  await settle();
  expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
});
it("requires login before saving and retries read failures without a write", async () => {
  h.user = "";
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.put).not.toHaveBeenCalled();
  h.user = "alice";
  h.get.mockRejectedValueOnce(new Error("Read failed"));
  await render();
  expect(host.querySelector("button")!.textContent).toBe("retry");
  await act(async () => host.querySelector("button")!.click());
  await settle();
  expect(host.querySelector("button")!.textContent).toBe("save");
  expect(h.put).not.toHaveBeenCalled();
});
