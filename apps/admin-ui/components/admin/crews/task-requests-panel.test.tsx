// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskRequestsPanel } from "./task-requests-panel";

vi.mock("./project-points-summary", () => ({ ProjectPointsSummary: () => null }));
vi.mock("@/lib/admin-api", () => ({ adminUiApiPath: (path: string) => path }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string }) => (
    <button data-variant={_variant} {...props}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
}));
vi.mock("@/components/ui/table", () => ({
  Table: (props: React.ComponentProps<"table">) => <table {...props} />,
  TableBody: (props: React.ComponentProps<"tbody">) => <tbody {...props} />,
  TableCell: (props: React.ComponentProps<"td">) => <td {...props} />,
  TableHead: (props: React.ComponentProps<"th">) => <th {...props} />,
  TableHeader: (props: React.ComponentProps<"thead">) => <thead {...props} />,
  TableRow: (props: React.ComponentProps<"tr">) => <tr {...props} />,
}));
const row = {
  id: "request",
  crewId: "crew",
  crewName: "Crew",
  kind: "manual",
  input: { title: "Shot", description: "Create scene", rewardUsdMinor: 0, profitShareBps: 100 },
  review: { title: "Shot" },
  requesterId: "creator",
  taskTitle: "Shot",
  userId: "creator",
  workspaceId: "workspace",
  points: 50,
  reason: "Render",
  status: "pending",
  createdAt: "2026-09-28T00:00:00Z",
};
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
let root: Root, host: HTMLDivElement;
const fetcher = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  fetcher.mockResolvedValue(ok({ items: [row], nextCursor: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
const render = async () => {
  await act(async () => root.render(<TaskRequestsPanel />));
};

it("requires an explicit decision and prevents duplicate approval while pending", async () => {
  await render();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => button("Review").click());
  expect(host.textContent).toContain("Revenue share (basis points)");
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => button("Approve and create tasks").click());
  expect(button("Approve and create tasks").disabled).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ decision: "approved", note: "" });
  await act(async () => button("Approve and create tasks").click());
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => finish(ok({ status: "approved" })));
  expect(button("Approve and create tasks")).toBeUndefined();
});
it("keeps a failed decision reviewable without claiming it was approved", async () => {
  await render();
  await act(async () => button("Review").click());
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Budget exhausted" }), { status: 409 })
  );
  await act(async () => button("Approve and create tasks").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Budget exhausted");
  expect(button("Approve and create tasks").disabled).toBe(false);
});
it("sends rejection without an approval side effect", async () => {
  await render();
  await act(async () => button("Review").click());
  fetcher.mockResolvedValueOnce(ok({ status: "rejected" }));
  await act(async () => button("Reject").click());
  expect(JSON.parse(fetcher.mock.calls[1][1].body).decision).toBe("rejected");
});
