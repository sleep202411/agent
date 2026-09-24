import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskAgreedFee } from "./task-agreed-fee";
const h = vi.hoisted(() => ({ user: "manager", get: vi.fn(), use: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("../_hooks/api", () => ({ crewApi: { get: (...a: unknown[]) => h.get(...a) } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "manager";
  vi.clearAllMocks();
  h.get.mockResolvedValue({
    required: true,
    items: [{ version: 2, currency: "USD", feeAmount: "12345" }],
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TaskAgreedFee taskId="task" userId="creator" onUse={h.use} />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
it("displays the effective fee and fills it only on an explicit action", async () => {
  await render();
  expect(host.textContent).toContain("USD 123.45");
  expect(h.use).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(h.use).toHaveBeenCalledWith("USD", "123.45");
});
it("explains missing active recruitment without inventing a fee", async () => {
  h.get.mockResolvedValue({ required: true, items: [] });
  await render();
  expect(host.textContent).toContain("noAgreement");
  expect(host.querySelector("button")).toBeNull();
});
it("hides prior account fees after authorization fails", async () => {
  await render();
  h.user = "other";
  h.get.mockRejectedValue(new Error("Forbidden"));
  await render();
  expect(host.textContent).not.toContain("123.45");
  expect(host.textContent).toContain("Forbidden");
});
