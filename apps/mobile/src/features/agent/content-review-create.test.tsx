import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContentReviewCreate } from "./content-review-create";
const h = vi.hoisted(() => ({
  generation: 1,
  job: null as any,
  role: "editor",
  begin: vi.fn(),
  run: vi.fn(),
  refund: vi.fn(),
  pick: vi.fn(),
  open: vi.fn(),
}));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "uuid" } }));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "u" }, generation: h.generation }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("./api/studio-workspace-settings-api", () => ({
  fetchWorkspaceSettings: async () => ({
    status: "active",
    accessScope: "workspace",
    role: h.role,
  }),
}));
vi.mock("./pick-review-video", () => ({ pickReviewVideo: h.pick }));
vi.mock("./content-review-workflow", () => ({
  contentReviewWorkflow: () => ({
    read: () => h.job,
    begin: h.begin,
    run: h.run,
    refund: h.refund,
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
let host: HTMLDivElement, root: Root;
const pending = () => ({
  id: "charge",
  phase: "ready",
  file: { name: "clip.mp4", size: 100, contentType: "video/mp4" },
  durationSeconds: 61,
  credits: 20,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.job = null;
  h.role = "editor";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  h.pick.mockResolvedValue({ source: pending().file, durationSeconds: 61, credits: 20 });
  h.begin.mockImplementation(async () => {
    h.job = pending();
    return h.job;
  });
  h.run.mockImplementation(async () => {
    h.job = { ...pending(), phase: "saved", recordId: "report" };
    return h.job;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(<ContentReviewCreate workspaceId="w" generation={1} onOpen={h.open} />)
  );
}
async function click(key: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === `contentReviewCreate.${key}`
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it("requires an explicit quote confirmation before running and opens the saved report", async () => {
  await render();
  await click("select");
  expect(h.begin).toHaveBeenCalledOnce();
  expect(h.run).not.toHaveBeenCalled();
  expect(host.textContent).toContain("20");
  await click("confirm");
  expect(h.run).toHaveBeenCalledOnce();
  await click("open");
  expect(h.open).toHaveBeenCalledWith("report");
});
it("restores pending uploads but requires reselecting the original file", async () => {
  h.job = { ...pending(), phase: "charged" };
  await render();
  const resume = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.endsWith(".resume")
  );
  expect(resume?.disabled).toBe(true);
  await click("reselect");
  expect(h.begin).not.toHaveBeenCalled();
  await click("resume");
  expect(h.run).toHaveBeenCalledOnce();
});
it("rejects a different original video and does not overwrite the recovery record", async () => {
  h.job = pending();
  h.pick.mockResolvedValue({ source: { ...pending().file, size: 101 }, durationSeconds: 61 });
  await render();
  await click("reselect");
  expect(host.textContent).toContain("originalMismatch");
  expect(h.begin).not.toHaveBeenCalled();
  expect(h.run).not.toHaveBeenCalled();
});
it("offers neither resubmission nor refund for an unknown submission", async () => {
  h.job = { ...pending(), phase: "submitting" };
  await render();
  expect(host.textContent).toContain("unknown");
  expect(host.textContent).toContain("charge");
  expect(host.querySelectorAll("button")).toHaveLength(0);
});
it("does not expose editor controls to viewers", async () => {
  h.role = "viewer";
  h.job = pending();
  await render();
  expect(host.textContent).toBe("");
  expect(h.run).not.toHaveBeenCalled();
});
it("locks double taps while running and aborts on unmount", async () => {
  h.run.mockImplementation(() => new Promise(() => {}));
  await render();
  await click("select");
  await click("confirm");
  const signal = h.run.mock.calls[0][0] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await click("confirm");
  expect(h.run).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  root = createRoot(host);
});
it("polls the same pending review after five seconds and stops after saving", async () => {
  vi.useFakeTimers();
  try {
    h.job = { ...pending(), phase: "reviewing" };
    h.run.mockResolvedValueOnce(h.job);
    await render();
    await click("resume");
    expect(h.run).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("phase.saved");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(h.run).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it("clears private controls after lost access and does not offer retry", async () => {
  await render();
  await click("select");
  h.run.mockRejectedValue(Object.assign(new Error("Access revoked"), { status: 403 }));
  await click("confirm");
  expect(host.textContent).toBe("Access revoked");
  expect(host.querySelectorAll("button")).toHaveLength(0);
});
it("refunds only following the explicit cancellation action", async () => {
  h.job = { ...pending(), phase: "failed", failure: "Provider failed" };
  h.refund.mockImplementation(async () => {
    h.job = { ...h.job, phase: "refunded" };
    return h.job;
  });
  await render();
  expect(h.refund).not.toHaveBeenCalled();
  await click("refund");
  expect(h.refund).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("phase.refunded");
});
it("binds confirmation to the visible review and clears its file if another tab replaced it", async () => {
  await render();
  await click("select");
  h.job = { ...pending(), id: "replacement" };
  h.run.mockRejectedValue(new Error("Review changed"));
  await click("confirm");
  expect(h.run.mock.calls[0][1]).toBe("charge");
  expect(host.textContent).toContain("Review changed");
  const confirm = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.endsWith(".confirm")
  );
  expect(confirm?.disabled).toBe(true);
  await click("reselect");
  h.run.mockImplementation(async () => {
    h.job = { ...h.job, phase: "saved", recordId: "report" };
    return h.job;
  });
  await click("confirm");
  expect(h.run.mock.calls[1][1]).toBe("replacement");
});
it("binds cancellation to the visible review instead of a newer stored review", async () => {
  h.job = pending();
  await render();
  h.job = { ...pending(), id: "replacement" };
  h.refund.mockRejectedValue(new Error("Review changed"));
  await click("discard");
  expect(h.refund).toHaveBeenCalledWith(expect.any(AbortSignal), "charge");
  expect(host.textContent).toContain("Review changed");
});
