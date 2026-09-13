// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { CrewTrustHistory } from "./crew-trust-history";
import { api } from "@/src/lib/api";
vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("does not retain another account's score and cancels its pending read", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
  const render = (id: string) =>
    root.render(
      <QueryClientProvider client={client}>
        <CrewTrustHistory userId={id} />
      </QueryClientProvider>
    );
  try {
    await act(async () => render("a"));
    const signal = vi.mocked(api.get).mock.calls[0][1]?.signal;
    await act(async () => render("b"));
    expect(signal?.aborted).toBe(true);
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/me/crew-trust/entries",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(host.textContent).toContain("loading");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("retains evidence after a failed next page and retries that page", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = {
    taskId: "task-a",
    submissionId: "submission-a",
    points: 200,
    submittedAt: "2026-01-01T00:00:00Z",
    deadline: "2026-01-02T00:00:00Z",
    recordedAt: "2026-01-03T00:00:00Z",
  };
  vi.mocked(api.get)
    .mockReset()
    .mockResolvedValueOnce({ items: [row], nextCursor: "task-a" })
    .mockRejectedValueOnce(new Error("Next page failed"))
    .mockResolvedValueOnce({ items: [{ ...row, taskId: "task-b" }], nextCursor: null });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <CrewTrustHistory userId="owner" />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => host.querySelector("button")!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(host.textContent).toContain("task-a");
    expect(host.textContent).toContain("Next page failed");
    await act(async () =>
      host
        .querySelector('[role="alert"] button')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(host.textContent).toContain("task-b");
    expect(api.get).toHaveBeenLastCalledWith(
      "/aurora/me/crew-trust/entries",
      expect.objectContaining({ params: { cursor: "task-a", limit: 20 } })
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
