// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpSubmissionsPanel } from "./submissions-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("reviews a pending submission with its expected version", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      code: 200,
      data: {
        items: [{ workId: "work", title: "Published work", status: "pending", version: 2 }],
        nextCursor: null,
      },
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    await act(async () =>
      root.render(
        <AdminSessionBoundary scopeKey="admin">
          <IpSubmissionsPanel ipId="channel" />
        </AdminSessionBoundary>
      )
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Approve")!
        .click()
    );
    const request = fetcher.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(request![1].body)).toEqual({
      workId: "work",
      status: "approved",
      expectedVersion: 2,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "retries a failed submissions page without reporting an empty queue (next=%s)",
  async (next) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const ok = (data: unknown) => ({ ok: true, json: async () => ({ code: 200, data }) });
    const page = {
      items: [{ workId: "work", title: "Published work", status: "pending", version: 2 }],
      nextCursor: "next-cursor",
    };
    const fetcher = vi.fn();
    if (next) fetcher.mockResolvedValueOnce(ok(page));
    fetcher.mockRejectedValueOnce(new Error("Submission service unavailable"));
    fetcher.mockResolvedValue(ok({ ...page, nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    try {
      await act(async () =>
        root.render(
          <AdminSessionBoundary scopeKey="admin">
            <IpSubmissionsPanel ipId="channel" />
          </AdminSessionBoundary>
        )
      );
      if (next)
        await act(async () =>
          [...container.querySelectorAll("button")]
            .find((b) => b.textContent === "Next page")!
            .click()
        );
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Submission service unavailable"
      );
      expect(container.textContent).not.toContain("No submissions.");
      const failedUrl = fetcher.mock.calls.at(-1)![0];
      await act(async () =>
        [...container.querySelectorAll("button")].find((b) => b.textContent === "Retry")!.click()
      );
      expect(fetcher.mock.calls.at(-1)![0]).toBe(failedUrl);
      expect(container.textContent).toContain("Published work");
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);
