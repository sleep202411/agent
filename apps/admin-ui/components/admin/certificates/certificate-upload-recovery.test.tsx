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

const createPreview = vi.fn();
const revokePreview = vi.fn();
function previewUrls() {
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: createPreview,
      revokeObjectURL: revokePreview,
    })
  );
  createPreview.mockReturnValue("blob:certificate-preview");
}
async function chooseFile(twice = false) {
  const field = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field, "files", {
    configurable: true,
    value: [new File(["image"], "certificate.png", { type: "image/png" })],
  });
  await act(async () => {
    field.dispatchEvent(new Event("change", { bubbles: true }));
    if (twice) field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("excludes duplicate uploads and saves until the uploaded asset is confirmed", async () => {
  previewUrls();
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response(page));
  await render(view());
  await act(async () => click("编辑"));
  await chooseFile(true);
  await act(async () => click("保存中…"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(createPreview).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response({ asset: { id: "new-asset", url: null } })));
  expect(revokePreview).toHaveBeenCalledWith("blob:certificate-preview");
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).imageAssetId).toBe("new-asset");
});
it("releases failed previews and retains the previously saved asset for retry", async () => {
  previewUrls();
  fetchMock
    .mockRejectedValueOnce(new Error("Upload unavailable"))
    .mockResolvedValue(response(page));
  await render(view());
  await act(async () => click("编辑"));
  await chooseFile();
  expect(container.textContent).toContain("Upload unavailable");
  expect(revokePreview).toHaveBeenCalledTimes(1);
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).imageAssetId).toBe("asset");
});
it("aborts replacement-session uploads and disposes their previews exactly once", async () => {
  previewUrls();
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response(page));
  await render(view());
  await act(async () => click("编辑"));
  await chooseFile();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  expect(revokePreview).toHaveBeenCalledTimes(1);
  await act(async () => click("编辑"));
  await act(async () => pending.resolve(response({ asset: { id: "abandoned-asset", url: null } })));
  expect(revokePreview).toHaveBeenCalledTimes(1);
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).imageAssetId).toBe("asset");
});
it("releases the pending guard if creating a preview throws", async () => {
  previewUrls();
  createPreview.mockImplementationOnce(() => {
    throw new Error("Preview unavailable");
  });
  fetchMock.mockResolvedValue(response({ asset: { id: "retry-asset", url: null } }));
  await render(view());
  await act(async () => click("编辑"));
  await chooseFile();
  expect(container.textContent).toContain("Preview unavailable");
  expect(fetchMock).not.toHaveBeenCalled();
  await chooseFile();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
