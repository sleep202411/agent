import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecruitmentStrip } from "./recruitment-strip";
const s = vi.hoisted(() => ({
  user: "a",
  agree: vi.fn(),
  refuse: vi.fn(),
  toast: vi.fn(),
  error: false,
  retry: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/hooks/use-certification", () => ({ useCertificationRoles: () => ({ data: {} }) }));
vi.mock("@/src/hooks/use-recruitment", () => ({
  useRecruitmentList: () => ({
    data: [{ id: "one", applyUsername: "Applicant" }],
    isError: s.error,
    error: s.error ? new Error("Read unavailable") : null,
    refetch: s.retry,
  }),
  useAgreeJobApply: () => ({ mutateAsync: s.agree }),
  useRefuseJobApply: () => ({ mutateAsync: s.refuse }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast } }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
let root: Root;
let node: HTMLDivElement;
async function render() {
  await act(async () => root.render(<RecruitmentStrip />));
}
function button(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text
  )!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.error = false;
  for (const fn of [s.agree, s.refuse, s.toast, s.retry]) fn.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("guards rapid approvals and ignores abandoned completion", async () => {
  let resolve!: () => void;
  s.agree.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    button("passApply").click();
    button("passApply").click();
    button("rejectApply").click();
  });
  expect(s.agree).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  s.user = "b";
  await render();
  await act(async () => resolve());
  expect(s.toast).not.toHaveBeenCalled();
});
it("does not close a replacement rejection dialog after old completion", async () => {
  let resolve!: () => void;
  s.refuse.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => button("rejectApply").click());
  await act(async () => {
    button("rejectApply", document.querySelector('[role="dialog"]')!).click();
    button("rejectApply", document.querySelector('[role="dialog"]')!).click();
  });
  expect(s.refuse).toHaveBeenCalledTimes(1);
  s.user = "b";
  await render();
  await act(async () => button("rejectApply").click());
  await act(async () => resolve());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(s.toast).not.toHaveBeenCalled();
});

it("keeps rejection drafts retryable after a failed request", async () => {
  s.refuse.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
  await render();
  await act(async () => button("rejectApply").click());
  const field = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Missing evidence"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
    button("rejectApply", document.querySelector('[role="dialog"]')!).click();
  });
  expect(s.toast).toHaveBeenCalledWith("processFailed");
  expect(document.querySelector("textarea")?.value).toBe("Missing evidence");
  await act(async () => button("rejectApply", document.querySelector('[role="dialog"]')!).click());
  expect(s.refuse).toHaveBeenCalledTimes(2);
  expect(s.refuse.mock.calls[1][0].message).toBe("Missing evidence");
});
