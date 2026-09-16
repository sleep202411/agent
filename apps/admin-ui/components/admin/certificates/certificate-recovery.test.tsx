// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { CertificatesPanel } from "./certificate-panel";
import type { AdminCertificateRow } from "./types";
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    SheetContent: Part,
    SheetHeader: Part,
    SheetTitle: Part,
    SheetFooter: Part,
  };
});
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    confirmLabel,
    onConfirm,
  }: {
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  }) => {
    const [error, setError] = useState("");
    return (
      <div>
        <button
          onClick={() => {
            void onConfirm().catch((err: Error) => setError(err.message));
          }}
        >
          {confirmLabel}
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();

const row: AdminCertificateRow = {
  id: "one",
  userId: "viewer",
  certNo: "FD-ONE",
  title: "Certificate",
  issuer: "Issuer",
  credentialType: "general",
  imageAssetId: "asset",
  imageUrl: null,
  issuedAt: "2026-01-01T00:00:00Z",
  revokedAt: "2026-01-02T00:00:00Z",
  revokedReason: "Old reason",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const page = { items: [row], total: 1, page: 1, pageSize: 20 };
const view = () => (
  <CertificatesPanel
    siteLabel="Global"
    databaseLabel="Fixture"
    initialData={page}
    initialError={null}
  />
);
function response(data: unknown = {}) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(view: ReactNode, session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
function click(text: string) {
  [...container.querySelectorAll("button")]
    .find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === text)!
    .click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("excludes overlapping restore/delete confirmations and keeps failures retryable", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response(page));
  await render(view());
  await act(async () => {
    click("恢复");
    click("永久删除");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Restore unavailable")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Restore unavailable");
  await act(async () => click("恢复"));
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2);
});
it("retains failed edit drafts and prevents duplicate saves", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response(page));
  await render(view());
  await act(async () => click("编辑"));
  await act(async () => {
    click("保存");
    click("保存");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => pending.reject(new Error("Save unavailable")));
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Save unavailable");
  await act(async () => click("保存"));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("cancels a replaced session's delete and skips its follow-up refresh", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("永久删除"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("FD-ONE");
});
it("retains a failed list and retries its read", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("List unavailable"))
    .mockResolvedValue(response({ ...page, items: [], total: 0 }));
  await render(view());
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("FD-ONE");
  expect(container.textContent).toContain("List unavailable");
  await act(async () => click("刷新"));
  expect(container.textContent).not.toContain("FD-ONE");
});
