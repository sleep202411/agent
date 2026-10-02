import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfileEditDialog } from "./profile-edit-dialog";
import type { UserInfoResolved } from "@/src/services/user";

const s = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn(), close: vi.fn(), error: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useUpdateUserInfo: () => ({ mutate: s.save, isPending: false }),
  useUploadAvatar: () => ({ mutateAsync: s.upload, isPending: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: s.error } }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
const profile = (id = "owner", nickName = "Original") =>
  ({ id, nickName, study: "[]", headImgUrl: "/old-avatar.png" }) as UserInfoResolved;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(user = profile(), open = true) {
  act(() => root.render(<ProfileEditDialog userInfo={user} open={open} onOpenChange={s.close} />));
}
const nickname = () =>
  document.querySelector<HTMLInputElement>('input[placeholder="enterNickname"]')!;
function editNickname(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      nickname(),
      value
    );
    nickname().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(async () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("save"))!.click()
  );
}
it("preserves text when an avatar refresh replaces the same user's record", async () => {
  render();
  editNickname("Unsaved name");
  render({ ...profile(), headImgUrl: "/new-avatar.png" });
  expect(nickname().value).toBe("Unsaved name");
  await save();
  expect(s.save.mock.calls[0][0]).toMatchObject({ nickName: "Unsaved name" });
});
it("starts a fresh draft when reopened or switched to another account", () => {
  render();
  editNickname("Unsaved name");
  render(profile(), false);
  render(profile("owner", "Updated"));
  expect(nickname().value).toBe("Updated");
  editNickname("Owner draft");
  render(profile("other", "Other user"));
  expect(nickname().value).toBe("Other user");
});
it("does not close a replacement editing session when an older save completes", async () => {
  render();
  await save();
  const old = s.save.mock.calls[0][1];
  render(profile(), false);
  render();
  editNickname("New session");
  act(() => old.onSuccess());
  expect(s.close).not.toHaveBeenCalled();
  expect(nickname().value).toBe("New session");
});
it("keeps the draft and surfaces the upstream save error", async () => {
  render();
  editNickname("Unsaved name");
  await save();
  act(() => s.save.mock.calls[0][1].onError(new Error("Profile update unavailable")));
  expect(s.error).toHaveBeenCalledWith("Profile update unavailable");
  expect(nickname().value).toBe("Unsaved name");
  expect(s.close).not.toHaveBeenCalled();
});
