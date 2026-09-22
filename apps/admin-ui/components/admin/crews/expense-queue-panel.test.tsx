// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ExpenseQueuePanel } from "./expense-queue-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 2,
  crewId: "crew-a",
  claimantUserId: "creator-a",
  submittedAt: "2026-09-13T00:00:00Z",
  definition: {
    category: "Travel",
    purpose: "Client meeting",
    occurredOn: "2026-09-12",
    currency: "USD",
    amountMinor: "999999999999999",
    evidenceNote: "Train ticket",
  },
};
const response = (items: unknown[], nextCursor: string | null = null) =>
  new Response(JSON.stringify({ code: 200, data: { items, nextCursor } }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([row], row.id)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const click = async (label: string) =>
  act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === label
    );
    if (!button) throw Error(label);
    button.click();
  });
it("preserves exact amounts and loaded revisions when the next page fails, retrying that cursor", async () => {
  await act(async () => root.render(<ExpenseQueuePanel />));
  expect(container.textContent).toContain("USD 9,999,999,999,999.99");
  expect(container.textContent).toContain("Train ticket");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Queue unavailable"));
  await click("Load more");
  expect(container.textContent).toContain("Client meeting");
  expect(container.textContent).toContain("Queue unavailable");
  vi.mocked(fetch).mockResolvedValueOnce(
    response([row, { ...row, id: "next", claimantUserId: "creator-b" }])
  );
  await click("Retry");
  expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain(`&after=${row.id}`);
  expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(container.textContent).not.toContain("Queue unavailable");
});
it("guards overlapping refreshes and ignores results after the session scope changes", async () => {
  await act(async () => root.render(<ExpenseQueuePanel key="old" />));
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await click("Refresh");
  await click("Refresh");
  expect(fetch).toHaveBeenCalledTimes(2);
  const signal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
  vi.mocked(fetch).mockResolvedValueOnce(response([]));
  await act(async () => root.render(<ExpenseQueuePanel key="new" />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(response([row])));
  expect(container.textContent).toContain("No pending submissions");
  expect(container.textContent).not.toContain("creator-a");
});

it.each(["", "/ops"])("uses configured base %s for queue and pagination", async (base) => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_UI_BASE_PATH", base);
  await act(async () => root.render(<ExpenseQueuePanel />));
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    `${base}/api/admin/crew-expense-submissions?limit=50`
  );
  vi.mocked(fetch).mockResolvedValueOnce(response([]));
  await click("Load more");
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
    `${base}/api/admin/crew-expense-submissions?limit=50&after=${row.id}`
  );
});
