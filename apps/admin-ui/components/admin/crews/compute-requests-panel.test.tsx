// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComputeRequestsPanel } from "./compute-requests-panel";

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
  await act(async () => root.render(<ComputeRequestsPanel />));
};

it("reviews the selected request and prevents duplicate approval while pending", async () => {
  await render();
  expect(host.textContent).toContain("50");
  await act(async () => button("Review").click());
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    button("Approve allowance").click();
    button("Approve allowance").click();
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe("/api/admin/crew-compute-requests/crew/request/decision");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ status: "approved", note: "" });
  expect(button("Reject").disabled).toBe(true);
  fetcher.mockResolvedValueOnce(ok({ items: [], nextCursor: null }));
  await act(async () => finish(ok(row)));
  expect(host.textContent).toContain("No requests.");
});

it("surfaces rejected approvals without claiming success", async () => {
  await render();
  await act(async () => button("Review").click());
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Insufficient balance" }), { status: 409 })
  );
  await act(async () => button("Approve allowance").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Insufficient balance");
  expect(button("Approve allowance").disabled).toBe(false);
});

it("cancels an in-flight action on unmount", async () => {
  await render();
  await act(async () => button("Review").click());
  fetcher.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => button("Reject").click());
  const signal = fetcher.mock.calls[1][1].signal as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
