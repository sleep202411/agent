// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CharacterEnrollmentWizard } from "./character-enrollment-wizard";
import type { CharacterDetail } from "@/lib/characters-api";
const s = vi.hoisted(() => ({
  user: "a",
  start: vi.fn(),
  complete: vi.fn(),
  status: vi.fn(),
  detail: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ user: { id: s.user } }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("@/lib/characters-api", () => ({
  createEnrollmentSession: s.start,
  completeEnrollment: s.complete,
  getEnrollmentStatus: s.status,
  characterApiErrorCode: (e: unknown) => (e instanceof Error ? e.message : null),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  s.user = "a";
  vi.clearAllMocks();
  s.status.mockReset().mockResolvedValue({ sessionStatus: "none" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <CharacterEnrollmentWizard
        character={{ id: "c", status: "draft" } as CharacterDetail}
        onDetail={s.detail}
      />
    )
  );
}
async function click(text: string) {
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === text)!
      .click()
  );
}
it("blocks rapid session creation and suppresses abandoned H5 links", async () => {
  let resolve!: (v: unknown) => void;
  s.start.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    const b = host.querySelector("button")!;
    b.click();
    b.click();
  });
  expect(s.start).toHaveBeenCalledTimes(1);
  const signal = s.start.mock.calls[0][1] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve({
      h5Link: "https://example.com/private",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    })
  );
  expect(host.querySelector("iframe")).toBeNull();
});
it("cancels completion and ignores late verified details", async () => {
  s.start.mockResolvedValue({
    h5Link: "https://example.com/h5",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  let resolve!: (v: unknown) => void;
  s.complete.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await click("enrollStart");
  await click("enrollCompleted");
  const signal = s.complete.mock.calls[0][1] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ id: "c", status: "active" }));
  expect(s.detail).not.toHaveBeenCalled();
  expect(s.success).not.toHaveBeenCalled();
});
it("reconciles already-completed creation only after releasing its admission", async () => {
  s.start.mockRejectedValue(new Error("ENROLLMENT_ALREADY_COMPLETED"));
  s.complete.mockResolvedValue({ id: "c", status: "active" });
  await render();
  await click("enrollStart");
  expect(s.complete).toHaveBeenCalledTimes(1);
  expect(s.detail).toHaveBeenCalled();
});
it("aborts mount status reads when the account leaves", async () => {
  s.status.mockImplementation(() => new Promise(() => {}));
  await render();
  const signal = s.status.mock.calls[0][1] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
});
