import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ProfileEditScreen from "@/app/profile-experience";
const h = vi.hoisted(() => ({
  focused: true,
  generation: 1,
  authenticated: true,
  login: vi.fn(),
  refresh: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
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
vi.mock("@/lib/api-client", () => ({ api: { post: h.post, get: h.get } }));
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
  h.get.mockResolvedValue([]);
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

const click = (label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
const experience = {
  id: 12,
  title: "Director",
  organization: "Studio",
  location: "SG",
  startTime: "2020-01",
  endTime: "",
  description: "A film",
};
it("loads the owner's endpoint and creates with only Web's fields", async () => {
  await render();
  expect(h.get).toHaveBeenCalledWith(
    "/user/resumer/me",
    expect.objectContaining({ service: "content" })
  );
  await act(async () => click("experienceEdit.add"));
  await act(async () => change("experienceEdit.role", " Producer "));
  await act(async () => save());
  expect(h.post).toHaveBeenCalledWith("/user/resumer/add", {
    service: "content",
    data: {
      title: "Producer",
      organization: "",
      location: "",
      startTime: "",
      endTime: "",
      description: "",
    },
  });
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("loads an existing entry and sends its id to update", async () => {
  h.get.mockResolvedValue([experience]);
  await render();
  await act(async () => click("experienceEdit.edit"));
  expect(input("experienceEdit.role").value).toBe("Director");
  await act(async () => change("experienceEdit.role", "Editor"));
  await act(async () => save());
  expect(h.post).toHaveBeenCalledWith("/user/resumer/update", {
    service: "content",
    data: { ...experience, id: "12", title: "Editor" },
  });
});
it("requires explicit confirmation before deletion and allows cancellation", async () => {
  h.get.mockResolvedValue([experience]);
  await render();
  await act(async () => click("experienceEdit.delete"));
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => click("experienceEdit.cancel"));
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => click("experienceEdit.delete"));
  await act(async () => click("experienceEdit.confirmDelete"));
  expect(h.post).toHaveBeenCalledWith("/user/resumer/delete/12", { service: "content" });
});
it("prevents repeated saves and preserves a failed draft", async () => {
  let fail!: (error: Error) => void;
  h.post.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    })
  );
  await render();
  await act(async () => click("experienceEdit.add"));
  await act(async () => change("experienceEdit.role", "Writer"));
  await act(async () => {
    save();
    save();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("Save unavailable")));
  expect(host.textContent).toContain("Save unavailable");
  expect(input("experienceEdit.role").value).toBe("Writer");
});
it("does not refresh another account after an old save finishes", async () => {
  let finish!: () => void;
  h.post.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () => click("experienceEdit.add"));
  await act(async () => change("experienceEdit.role", "Writer"));
  await act(async () => save());
  h.generation = 2;
  await render();
  await act(async () => finish());
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(host.querySelector("input")).toBeNull();
});
it("supports load retry and keeps guest deep links private", async () => {
  h.get.mockRejectedValueOnce(new Error("Offline"));
  await render();
  expect(host.textContent).toContain("Offline");
  await act(async () => click("profileEdit.retry"));
  expect(h.get).toHaveBeenCalledTimes(2);
  h.authenticated = false;
  await render();
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "login.signIn",
  ]);
  expect(host.querySelector("input")).toBeNull();
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
