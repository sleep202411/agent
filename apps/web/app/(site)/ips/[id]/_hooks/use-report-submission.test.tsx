import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useReportSubmission } from "./use-report-submission";
const s = vi.hoisted(() => ({ report: vi.fn(), block: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useReportIpContent: () => ({ mutateAsync: s.report, isPending: false }),
  useBlockIpContent: () => ({ mutateAsync: s.block, isPending: false }),
}));
let root: Root;
let api: ReturnType<typeof useReportSubmission>;
function View({ userId }: { userId: string }) {
  const submission = useReportSubmission(userId);
  useLayoutEffect(() => {
    api = submission;
  });
  return null;
}
const input = {
  ipId: "ip",
  report: {
    targetType: "episode" as const,
    targetId: "episode",
    reason: "copyright" as const,
    description: "Details",
  },
  blockIp: true,
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  s.report.mockReset().mockResolvedValue({});
  s.block.mockReset().mockResolvedValue({});
  act(() => root.render(<View userId="alice" />));
});
afterEach(() => act(() => root.unmount()));
it("retries only blocking after the report was accepted", async () => {
  s.block.mockRejectedValueOnce(new Error("Block failed"));
  await expect(api.submit(input)).rejects.toThrow("Block failed");
  await expect(api.submit(input)).resolves.toBe(true);
  expect(s.report).toHaveBeenCalledTimes(1);
  expect(s.block).toHaveBeenCalledTimes(2);
});
it("retries reporting after report failure and does not block prematurely", async () => {
  s.report.mockRejectedValueOnce(new Error("Report failed"));
  await expect(api.submit(input)).rejects.toThrow("Report failed");
  expect(s.block).not.toHaveBeenCalled();
  await api.submit(input);
  expect(s.report).toHaveBeenCalledTimes(2);
  expect(s.block).toHaveBeenCalledTimes(1);
});
it.each(["user", "target", "description"])(
  "does not reuse a different %s report",
  async (change) => {
    s.block.mockRejectedValueOnce(new Error("Block failed"));
    await expect(api.submit(input)).rejects.toThrow();
    if (change === "user") act(() => root.render(<View userId="bob" />));
    const report = {
      ...input.report,
      ...(change === "target" ? { targetId: "other" } : {}),
      ...(change === "description" ? { description: "Changed" } : {}),
    };
    await api.submit({ ...input, report });
    expect(s.report).toHaveBeenCalledTimes(2);
  }
);
it("finishes an accepted report without repeating it when blocking is deselected", async () => {
  s.block.mockRejectedValueOnce(new Error("Block failed"));
  await expect(api.submit(input)).rejects.toThrow();
  await api.submit({ ...input, blockIp: false });
  expect(s.report).toHaveBeenCalledTimes(1);
  expect(s.block).toHaveBeenCalledTimes(1);
});
it("allows a later report after a fully completed submission", async () => {
  await api.submit(input);
  await api.submit(input);
  expect(s.report).toHaveBeenCalledTimes(2);
});
it("prevents overlapping submissions", async () => {
  let finish!: () => void;
  s.report.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  const first = api.submit(input);
  await expect(api.submit(input)).resolves.toBe(false);
  finish();
  await first;
  expect(s.report).toHaveBeenCalledTimes(1);
});
