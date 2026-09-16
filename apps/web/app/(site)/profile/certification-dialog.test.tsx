import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CertificationDialog } from "./certification-dialog";
const s = vi.hoisted(() => ({
  user: "a",
  upload: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
  certsLoaded: true,
  certsError: false,
  rolesLoaded: true,
  retry: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast, warning: s.toast } }));
vi.mock("@/src/lib/api", () => ({ api: { upload: s.upload } }));
vi.mock("@/src/lib/uploads/workspace-upload", () => ({ buildOssUrl: (value: string) => value }));
vi.mock("@/src/hooks/use-certification", () => ({
  useMyCertifications: () => ({
    data: s.certsLoaded ? [{ id: 1, authRoleId: 1, authStatus: 3 }] : undefined,
    isError: s.certsError,
    error: s.certsError ? new Error("Certificates unavailable") : null,
    refetch: s.retry,
  }),
  useCertificationRoles: () => ({
    data: s.rolesLoaded ? { 1: "Director" } : undefined,
    isError: !s.rolesLoaded,
    error: !s.rolesLoaded ? new Error("Roles unavailable") : null,
    refetch: s.retry,
  }),
  useSubmitCertification: () => ({ mutateAsync: s.update }),
  useUpdateCertification: () => ({ mutateAsync: s.update }),
}));
let root: Root;
let node: HTMLDivElement;
async function render(open = true) {
  await act(async () => root.render(<CertificationDialog open={open} onOpenChange={() => {}} />));
}
function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text)
  )!;
}
async function edit() {
  await act(async () => button("Director").click());
}
async function upload(twice = false) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["x"], "proof.png", { type: "image/png" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (twice) input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.certsLoaded = true;
  s.certsError = false;
  s.rolesLoaded = true;
  s.retry.mockClear();
  s.upload.mockReset().mockResolvedValue("/proof.png");
  s.update.mockReset().mockResolvedValue({});
  s.toast.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:proof");
  URL.revokeObjectURL = vi.fn();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("guards duplicate uploads and abandons them when the account changes", async () => {
  let resolve!: (s: string) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await edit();
  await upload(true);
  expect(s.upload).toHaveBeenCalledTimes(1);
  const signal = s.upload.mock.calls[0][3].signal as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve("/proof.png"));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
});
it("retains proof after submission failure and prevents duplicate submission", async () => {
  await render();
  await edit();
  await upload();
  s.update.mockRejectedValueOnce(new Error("offline"));
  await act(async () => button("submit").click());
  expect(document.querySelector('img[src="blob:proof"]')).not.toBeNull();
  let resolve!: (value: unknown) => void;
  s.update.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await act(async () => {
    button("submit").click();
    button("submit").click();
  });
  expect(s.update).toHaveBeenCalledTimes(2);
  await render(false);
  s.toast.mockClear();
  await act(async () => resolve({}));
  expect(s.toast).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:proof");
});

it("blocks submission while role evidence is unavailable and permits recovery", async () => {
  await render();
  await edit();
  await upload();
  s.rolesLoaded = false;
  await render();
  expect(button("submit").disabled).toBe(true);
  s.rolesLoaded = true;
  await render();
  expect(button("submit").disabled).toBe(false);
});

it("cancels uploads when the form closes without replacing the account", async () => {
  let resolve!: (value: string) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await edit();
  await upload();
  const signal = s.upload.mock.calls[0][3].signal as AbortSignal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve("/old-proof.png"));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
});
