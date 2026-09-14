// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BillingComputeMemberUsagePanel } from "./compute-member-usage-panel";
import type { AdminComputeMemberUsageData } from "./types";
import { requestEnvelope } from "./shared";
vi.mock("./shared", async (original) => ({
  ...await original<typeof import("./shared")>(),
  requestEnvelope: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("accepts new server data without resetting local refresh results on unchanged props", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const initial: AdminComputeMemberUsageData = {
    rangeDays: 30, workspaceKind: "all", workspaceId: null,
    totalCredits: "111", memberCount: 0, workspaceCount: 0, members: [],
  };
  const render = (data: AdminComputeMemberUsageData | null) => root.render(
    <BillingComputeMemberUsagePanel siteLabel="Test" databaseLabel="Local" initialData={data} />
  );
  try {
    await act(async () => render(initial));
    expect(container.textContent).toContain("111");
    vi.mocked(requestEnvelope).mockResolvedValue({...initial,totalCredits:"222"});
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="刷新"]')!.click());
    expect(container.textContent).toContain("222");
    await act(async () => render(initial));
    expect(container.textContent).toContain("222");
    await act(async () => render({...initial,totalCredits:"333"}));
    expect(container.textContent).toContain("333");
    expect(container.textContent).not.toContain("222");
    await act(async () => render(null));
    expect(container.textContent).toContain("333");
  } finally { act(() => root.unmount()); }
});
