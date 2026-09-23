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
  const fetcher = vi
    .fn()
    .mockResolvedValue({
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
