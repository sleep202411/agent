// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
vi.mock("./submissions-panel", () => ({ IpSubmissionsPanel: () => null }));
import { IpChannelPanel } from "./channel-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("keeps failed category edits retryable", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSaved = vi.fn();
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Conflict: refresh first"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, data: {} }) });
  vi.stubGlobal("fetch", fetcher);
  try {
    await act(async () =>
      root.render(
        <AdminSessionBoundary scopeKey="admin">
          <IpChannelPanel ipId="ip-id" version={7} channelType="community" onSaved={onSaved} />
        </AdminSessionBoundary>
      )
    );
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "ip";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Conflict: refresh first");
    expect(onSaved).not.toHaveBeenCalled();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      channelType: "ip",
      expectedVersion: 7,
    });
    await act(async () => container.querySelector("button")!.click());
    expect(onSaved).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
