// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectPointsSummary } from "./project-points-summary";
vi.mock("@/lib/admin-api", () => ({ adminUiApiPath: (path: string) => path }));
it("renders real project totals and warnings, filters budgets and opens project details", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const row = {
    crewId: "crew",
    crewName: "Film",
    producerUserId: "producer",
    durationSeconds: 60,
    pointsPerMinute: 4460,
    calculatedPoints: "4460",
    appliedPoints: "5000",
    approvedPoints: "4500",
    pendingPoints: "500",
    creditedPoints: "500",
    differencePoints: "540",
    warning: false,
    closed: false,
  };
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 200, data: { items: [row], nextCursor: null } }))
      )
    );
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    details = vi.fn();
  try {
    await act(async () => root.render(<ProjectPointsSummary revision={0} onDetails={details} />));
    expect(host.textContent).toContain("4,460");
    expect(host.textContent).toContain("540");
    expect(host.textContent).toContain("Over budget");
    expect(host.textContent).not.toContain("Difference exceeds ±20%");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "View details / configure")!
        .click()
    );
    expect(details).toHaveBeenCalledWith("crew");
    await act(async () => {
      const select = host.querySelector("select")!;
      select.value = "over";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain("state=over");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
