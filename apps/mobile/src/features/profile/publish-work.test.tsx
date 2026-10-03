import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import ProfileEditScreen from "@/app/publish-work";
const h = vi.hoisted(() => ({
  records: new Map<string, string>(),
  storageFailure: false,
  workId: undefined as string | undefined,
  find: vi.fn(),
  page: vi.fn(),
  update: vi.fn(),
  focused: true,
  generation: 1,
  authenticated: true,
  login: vi.fn(),
  refresh: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  upload: vi.fn(),
  pick: vi.fn(),
  create: vi.fn(),
  back: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, userId: string, entry: string) => {
    const key = JSON.stringify([namespace, userId, entry]);
    return {
      read: () => h.records.get(key) ?? null,
      write: (value: string) => {
        if (h.storageFailure) throw new Error("Disk full");
        h.records.set(key, value);
      },
    };
  },
}));
vi.mock("./publish-work-api", () => ({
  getWorkTags: h.get,
  createWork: h.create,
  updateWork: h.update,
  pickWorkFile: h.pick,
  uploadWorkFile: h.upload,
}));
vi.mock("@/data/mine-api", () => ({ findMyWork: h.find, fetchMyWorksPage: h.page }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ workId: h.workId }),
  useIsFocused: () => h.focused,
  useRouter: () => ({ back: h.back }),
}));
vi.mock("@/auth", () => ({
  useLoginGateOnFocus: vi.fn(),
  useAuthGate: () => ({ requireAuth: h.login }),
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    session: { token: { tokenValue: "test-token" } },
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
    AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
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
  h.records.clear();
  h.storageFailure = false;
  h.workId = undefined;
  h.focused = true;
  h.generation = 1;
  h.authenticated = true;
  h.refresh.mockResolvedValue(user);
  h.post.mockResolvedValue(undefined);
  h.get.mockResolvedValue([{ id: 1, name: "Drama" }]);
  h.create.mockResolvedValue("12");
  h.pick.mockResolvedValue({
    uri: "file:///video",
    name: "v.mp4",
    mimeType: "video/mp4",
    size: 100,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = () => act(async () => root.render(<ProfileEditScreen />));
const input = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function change(label: string, value: string) {
  const el = input(label);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const click = (label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click();

async function fill() {
  await render();
  await act(async () => {
    change("publishWork.name", "Film");
    change("publishWork.description", "Story");
    click("Drama");
  });
}
it("creates once on rapid taps and uploads to the same record after retry", async () => {
  await fill();
  await act(async () => {
    click("publishWork.next");
    click("publishWork.next");
  });
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(h.create.mock.calls[0][0]).toEqual({ title: "Film", description: "Story", tagIds: [1] });
  h.upload.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  await act(async () => click("publishWork.video"));
  expect(host.textContent).toContain("offline");
  await act(async () => click("publishWork.video"));
  expect(h.upload.mock.calls[1][0]).toBe("12");
  expect(h.create).toHaveBeenCalledTimes(1);
  await act(async () => click("publishWork.done"));
  expect(h.back).toHaveBeenCalledTimes(1);
});
it("does not upload after a canceled picker or foreign-account completion", async () => {
  await fill();
  await act(async () => click("publishWork.next"));
  h.pick.mockResolvedValueOnce(null);
  await act(async () => click("publishWork.video"));
  expect(h.upload).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void;
  h.pick.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => click("publishWork.video"));
  h.generation = 2;
  await render();
  await act(async () =>
    finish({ uri: "file:///v", name: "v.mp4", mimeType: "video/mp4", size: 100 })
  );
  expect(h.upload).not.toHaveBeenCalled();
});
it("keeps tag failures retryable and never creates before required fields", async () => {
  h.get.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(host.textContent).toContain("offline");
  await act(async () => click("publishWork.next"));
  expect(h.create).not.toHaveBeenCalled();
  await act(async () => click("profileEdit.retry"));
  expect(host.textContent).toContain("Drama");
  expect(host.textContent).not.toContain("offline");
});
it("hides publishing from signed-out deep links", async () => {
  h.authenticated = false;
  await render();
  expect(h.get).not.toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
});

it("reopens an owned work, updates metadata without creating and reuses its upload ID", async () => {
  h.workId = "42";
  h.find.mockResolvedValue({
    id: "42",
    title: "Existing",
    introduction: "Story",
    hasVideo: true,
    isPrivate: true,
  });
  await render();
  expect(input("publishWork.name").value).toBe("Existing");
  expect(h.get).not.toHaveBeenCalled();
  await act(async () => {
    change("publishWork.name", "Changed");
    click("publishWork.next");
  });
  expect(h.create).not.toHaveBeenCalled();
  expect(h.update.mock.calls[0].slice(0, 3)).toEqual(["42", "Changed", "Story"]);
  await act(async () => click("publishWork.cover"));
  expect(h.upload.mock.calls[0][0]).toBe("42");
  await act(async () => click("publishWork.done"));
  expect(h.back).toHaveBeenCalled();
});
it("does not expose editing for an unavailable foreign work", async () => {
  h.workId = "foreign";
  h.find.mockRejectedValue(new Error("not found"));
  await render();
  expect(host.textContent).toContain("not found");
  expect(host.querySelector("input")).toBeNull();
  expect(h.create).not.toHaveBeenCalled();
  expect(h.update).not.toHaveBeenCalled();
});

it("restores the created work ID after remount and rechecks ownership before uploading", async () => {
  await fill();
  await act(async () => click("publishWork.next"));
  await act(async () => root.unmount());
  root = createRoot(host);
  h.find.mockResolvedValue({
    id: "12",
    title: "Film",
    introduction: "Story",
    isPrivate: false,
    hasVideo: false,
  });
  await render();
  expect(h.find.mock.calls[0][0]).toBe("12");
  expect(host.querySelector("input")).toBeNull();
  await act(async () => click("publishWork.video"));
  expect(h.upload.mock.calls[0][0]).toBe("12");
  expect(h.create).toHaveBeenCalledTimes(1);
  await act(async () => click("publishWork.done"));
  expect([...h.records.values()].every((raw) => JSON.parse(raw).draft === null)).toBe(true);
});
it("blocks duplicate creation after a lost response, including after remount", async () => {
  h.create.mockRejectedValue(new Error("Lost response"));
  await fill();
  await act(async () => click("publishWork.next"));
  await act(async () => click("publishWork.next"));
  expect(h.create).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(input("publishWork.name").value).toBe("Film");
  expect(input("publishWork.name").disabled).toBe(true);
  expect(host.textContent).toContain("publishWork.creationUnknown");
  await act(async () => click("publishWork.next"));
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("does not create when recovery state cannot be saved", async () => {
  await fill();
  h.storageFailure = true;
  await act(async () => click("publishWork.next"));
  expect(h.create).not.toHaveBeenCalled();
  expect(input("publishWork.name").disabled).toBe(false);
  expect(host.textContent).toContain("Disk full");
});

it("restores an interrupted metadata update without creating another record", async () => {
  h.workId = "42";
  h.find.mockResolvedValue({
    id: "42",
    title: "Existing",
    introduction: "Old story",
    hasVideo: true,
    isPrivate: true,
  });
  h.update
    .mockRejectedValueOnce(new Error("Lost update response"))
    .mockResolvedValueOnce(undefined);
  await render();
  await act(async () => change("publishWork.name", "Edited title"));
  await act(async () => click("publishWork.next"));
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(input("publishWork.name").value).toBe("Edited title");
  expect(input("publishWork.name").disabled).toBe(true);
  await act(async () => click("publishWork.next"));
  expect(h.update.mock.calls[0].slice(0, 3)).toEqual(h.update.mock.calls[1].slice(0, 3));
  expect(h.create).not.toHaveBeenCalled();
});

it.each(["success", "not-owned", "changed-account", "storage-failure"])(
  "recovers an unknown creation through explicit owner selection: %s",
  async (outcome) => {
    const owned = {
      id: "42",
      title: "Film",
      introduction: "Story",
      isPrivate: false,
      hasVideo: false,
    };
    h.page.mockResolvedValue({ works: [owned], hasMore: false });
    h.create.mockRejectedValue(new Error("Lost response"));
    await fill();
    await act(async () => click("publishWork.next"));
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await act(async () => click("publishWork.checkWorks"));
    await act(async () => click("FilmStory"));
    expect(h.find).not.toHaveBeenCalled();
    h.find.mockImplementation(async () => {
      if (outcome === "not-owned") throw new Error("Not owned");
      if (outcome === "changed-account") h.generation = 2;
      if (outcome === "storage-failure") h.storageFailure = true;
      return owned;
    });
    await act(async () => click("publishWork.useExisting"));
    expect(h.create).toHaveBeenCalledTimes(1);
    const record = JSON.parse([...h.records.values()][0]).draft;
    if (outcome === "success") {
      expect(record.workId).toBe("42");
      expect(record.phase).toBe("uploading");
      await act(async () => click("publishWork.video"));
      expect(h.upload.mock.calls[0][0]).toBe("42");
    } else {
      expect(record.phase).toBe("creating");
      expect(record.workId).toBeUndefined();
      expect(h.upload).not.toHaveBeenCalled();
    }
  }
);

it("offers sign-in again after the guest dismisses the automatic login sheet", async () => {
  h.authenticated = false;
  await render();
  expect(host.textContent).not.toContain("loading");
  expect(host.querySelector("input")).toBeNull();
  expect(h.get).not.toHaveBeenCalled();
  await act(async () => click("login.signIn"));
  expect(h.login).toHaveBeenCalledTimes(1);
  expect(h.create).not.toHaveBeenCalled();
  h.authenticated = true;
  await render();
  expect(input("publishWork.name")).toBeTruthy();
});
