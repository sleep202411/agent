import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkbenchDashboard } from "./workbench-dashboard";
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string, values?: { status: string }) =>
    values ? `${key}: ${values.status}` : key,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each(["failed", "analyzing", "completed"])(
  "keeps %s analysis visible on the initialization action",
  (status) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const open = vi.fn();
    try {
      act(() =>
        root.render(
          <WorkbenchDashboard
            tasks={[]}
            ready
            canInitialize
            disabled={false}
            analysisStatus={status}
            onInitialize={open}
          />
        )
      );
      expect(host.querySelector("dl")).toBeNull();
      expect(host.querySelector("button")?.textContent).toContain(`analysis_${status}`);
      act(() => host.querySelector("button")!.click());
      expect(open).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
    }
  }
);
