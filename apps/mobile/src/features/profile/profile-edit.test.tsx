import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ProfileEditScreen from "@/app/profile-edit";
import { profileDraft } from "./api";
const h = vi.hoisted(() => ({
  focused: true,
  generation: 1,
  authenticated: true,
  login: vi.fn(),
  refresh: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
  back: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("./avatar-upload", () => ({
  AvatarValidationError: class extends Error {},
  pickAndUploadProfileImage: h.upload,
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => h.focused,
  useRouter: () => ({ back: h.back }),
}));
vi.mock("@/auth", () => ({
  useLoginGateOnFocus: vi.fn(),
  useAuthGate: () => ({ requireAuth: h.login }),
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: String(h.generation) },
    refreshCurrentUser: h.refresh,
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    View: Box,
    ScrollView: Box,
    KeyboardAvoidingView: Box,
    ActivityIndicator: () => <span>loading</span>,
    Platform: { OS: "web", select: (v: Record<string, unknown>) => v.web ?? v.default },
    StyleSheet: { create: (v: unknown) => v },
    TextInput: ({
      value,
      onChangeText,
      editable,
      accessibilityLabel,
    }: {
      value: string;
      onChangeText: (s: string) => void;
      editable: boolean;
      accessibilityLabel: string;
    }) => (
      <input
        aria-label={accessibilityLabel}
        value={value}
        disabled={!editable}
        onChange={(e) => onChangeText(e.target.value)}
      />
    ),
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children: ReactNode;
      onPress: () => void;
      disabled: boolean;
    }) => (
      <button disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const user = {
  nickName: "Alice",
  contact: "hello",
  description: "Bio",
  other: "Notes",
  study: "Keep education",
  availableForWork: true,
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  h.focused = true;
  h.generation = 1;
  h.authenticated = true;
  h.refresh.mockResolvedValue(user);
  h.post.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = () => act(async () => root.render(<ProfileEditScreen />));
const save = () =>
  [...host.querySelectorAll("button")]
    .find((b) => b.textContent?.includes("profileEdit.save"))!
    .click();
const input = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function change(label: string, value: string) {
  const el = input(label);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
it("loads current profile and writes only the editable Web fields before refreshing Mine", async () => {
  await render();
  expect(input("profileEdit.nickname").value).toBe("Alice");
  await act(async () => {
    change("profileEdit.nickname", "  New name  ");
    change("profileEdit.bio", "Updated bio");
  });
  await act(async () => save());
  expect(h.post).toHaveBeenCalledExactlyOnceWith("/user/update/user/info", {
    service: "content",
    data: { nickName: "New name", contact: "hello", description: "Updated bio", other: "Notes" },
  });
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(h.back).toHaveBeenCalledOnce();
});
it("rejects blank nicknames and supports clearing optional fields", async () => {
  await render();
  await act(async () => change("profileEdit.nickname", "   "));
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("profileEdit.save"))!
      .disabled
  ).toBe(true);
  await act(async () => {
    change("profileEdit.nickname", "Name");
    change("profileEdit.contact", "");
  });
  await act(async () => save());
  expect(h.post.mock.calls[0][1].data.contact).toBe("");
});
it("blocks rapid repeated saves and exposes the actual server failure for retry", async () => {
  let reject!: (error: Error) => void;
  h.post.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    })
  );
  await render();
  await act(async () => {
    save();
    save();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Nickname unavailable")));
  expect(host.textContent).toContain("Nickname unavailable");
  expect(h.back).not.toHaveBeenCalled();
  await act(async () => save());
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.back).toHaveBeenCalledOnce();
});
it("does not refresh or dismiss another account's editor on late completion", async () => {
  let resolve!: () => void;
  h.post.mockReturnValueOnce(
    new Promise<void>((yes) => {
      resolve = yes;
    })
  );
  await render();
  await act(async () => save());
  h.generation = 2;
  h.refresh.mockResolvedValue({ ...user, nickName: "Bob" });
  await render();
  await act(async () => resolve());
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(input("profileEdit.nickname").value).toBe("Bob");
  expect(h.back).not.toHaveBeenCalled();
});
it("provides a retry after a profile-load failure without submitting empty data", async () => {
  h.refresh.mockRejectedValueOnce(new Error("Offline"));
  await render();
  expect(host.textContent).toContain("Offline");
  expect(host.querySelectorAll("input")).toHaveLength(0);
  await act(async () => host.querySelector("button")!.click());
  expect(input("profileEdit.nickname").value).toBe("Alice");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not load private profile data for a signed-out deep link", async () => {
  h.authenticated = false;
  await render();
  expect(h.refresh).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("normalizes legacy names while leaving absent optional fields empty", () => {
  expect(profileDraft({ nickname: "Legacy", contact: null, description: 42 })).toEqual({
    nickName: "Legacy",
    contact: "",
    description: "",
    other: "",
  });
});
it("keeps draft values when translation functions change", async () => {
  await render();
  await act(async () => change("profileEdit.nickname", "Unsaved"));
  const previous = h.t;
  try {
    h.t = (key: string) => key;
    await render();
    expect(input("profileEdit.nickname").value).toBe("Unsaved");
    expect(h.refresh).toHaveBeenCalledTimes(1);
  } finally {
    h.t = previous;
  }
});
it("does not navigate back if a save finishes after the editor loses focus", async () => {
  let resolve!: () => void;
  h.post.mockReturnValueOnce(
    new Promise<void>((yes) => {
      resolve = yes;
    })
  );
  await render();
  await act(async () => save());
  h.focused = false;
  await render();
  await act(async () => resolve());
  expect(h.back).not.toHaveBeenCalled();
});

it("uploads immediately without saving or discarding the text draft", async () => {
  h.upload.mockResolvedValue(true);
  await render();
  await act(async () => change("profileEdit.nickname", "Unsaved"));
  await act(async () => host.querySelector("button")!.click());
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(input("profileEdit.nickname").value).toBe("Unsaved");
  expect(h.post).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(host.textContent).toContain("profileEdit.avatarUpdated");
});
it("locks repeated picks and makes a late picker stale on blur", async () => {
  let finish!: (uploaded: boolean) => void;
  h.upload.mockReturnValue(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.upload).toHaveBeenCalledTimes(1);
  const [current, signal] = h.upload.mock.calls[0];
  h.focused = false;
  await render();
  expect(current()).toBe(false);
  expect(signal.aborted).toBe(true);
  await act(async () => finish(true));
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("preserves education when saving unrelated fields", async () => {
  await render();
  expect(input("profileEdit.school 1").value).toBe("Keep education");
  await act(async () => save());
  expect(h.post.mock.calls[0][1].data).not.toHaveProperty("study");
});
it("saves structured education and supports removing the last entry", async () => {
  await render();
  await act(async () => change("profileEdit.school 1", " Film school "));
  await act(async () => change("profileEdit.major 1", " Animation "));
  await act(async () => change("profileEdit.startDate 1", "2020-09"));
  await act(async () => save());
  expect(JSON.parse(h.post.mock.calls[0][1].data.study)).toEqual([
    { schoolName: "Film school", major: "Animation", startDate: "2020-09", endDate: "" },
  ]);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "profileEdit.removeEducation")!
      .click()
  );
  await act(async () => save());
  expect(h.post.mock.calls[1][1].data.study).toBe("");
});
it("adds multiple education entries without losing the existing one", async () => {
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "profileEdit.addEducation")!
      .click()
  );
  await act(async () => change("profileEdit.school 2", "Second school"));
  await act(async () => save());
  expect(
    JSON.parse(h.post.mock.calls[0][1].data.study).map((e: { schoolName: string }) => e.schoolName)
  ).toEqual(["Keep education", "Second school"]);
});
it("keeps unreadable legacy education untouched during an unrelated save", async () => {
  h.refresh.mockResolvedValue({ ...user, study: "[broken legacy JSON" });
  await render();
  await act(async () => change("profileEdit.contact", "updated"));
  await act(async () => save());
  expect(h.post.mock.calls[0][1].data).not.toHaveProperty("study");
});
it("loads structured education with optional end dates", async () => {
  h.refresh.mockResolvedValue({
    ...user,
    study: JSON.stringify([{ schoolName: "School", major: "Film", startDate: "2025-01" }]),
  });
  await render();
  expect(input("profileEdit.school 1").value).toBe("School");
  expect(input("profileEdit.endDate 1").value).toBe("");
});

it("uploads a public cover without saving the text draft or leaving the editor", async () => {
  h.upload.mockResolvedValue(true);
  await render();
  await act(async () => change("profileEdit.nickname", "Unsaved"));
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "profileEdit.bannerChange")!
      .click()
  );
  expect(h.upload.mock.calls[0][2]).toBe("banner");
  expect(h.refresh).toHaveBeenCalledTimes(2);
  expect(input("profileEdit.nickname").value).toBe("Unsaved");
  expect(host.textContent).toContain("profileEdit.bannerUpdated");
  expect(h.post).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("changes work availability only on explicit profile save", async () => {
  await render();
  const toggle = () =>
    [...host.querySelectorAll("button")].find(
      (b) =>
        b.textContent === "profileEdit.available" ||
        b.textContent === "profileEdit.unavailable" ||
        b.textContent === "profileEdit.availabilityUnknown"
    )!;
  expect(toggle().textContent).toBe("profileEdit.available");
  await act(async () => toggle().click());
  expect(toggle().textContent).toBe("profileEdit.unavailable");
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => save());
  expect(h.post.mock.calls[0][1].data.availableForWork).toBe(false);
});
it("does not infer availability when the server omits it", async () => {
  h.refresh.mockResolvedValue({ ...user, availableForWork: undefined });
  await render();
  expect(host.textContent).toContain("profileEdit.availabilityUnknown");
  await act(async () => save());
  expect(h.post.mock.calls[0][1].data).not.toHaveProperty("availableForWork");
});
it("lets an unspecified creator explicitly opt into availability", async () => {
  h.refresh.mockResolvedValue({ ...user, availableForWork: undefined });
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "profileEdit.availabilityUnknown")!
      .click()
  );
  await act(async () => save());
  expect(h.post.mock.calls[0][1].data.availableForWork).toBe(true);
});

it("keeps a usable sign-in action after the guest closes the login sheet", async () => {
  h.authenticated = false;
  await render();
  expect(host.textContent).not.toContain("loading");
  expect(host.querySelector("input")).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
  const signIn = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "login.signIn"
  );
  expect(signIn).toBeDefined();
  await act(async () => signIn!.click());
  expect(h.login).toHaveBeenCalledTimes(1);
  expect(h.post).not.toHaveBeenCalled();
});
