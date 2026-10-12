import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LevelApplicationForm } from "./level-application";
const h = vi.hoisted(() => ({
  held: [] as { id: number }[],
  generation: 1,
  active: true,
  focused: true,
  records: new Map<string, string>(),
  get: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  close: vi.fn(),
  change: (_active: boolean) => {},
}));
vi.mock("@/auth/auth-store", () => ({
  getAuthGeneration: () => h.generation,
  getAuthSnapshot: () => ({ user: { levels: h.held } }),
}));
vi.mock("@/config", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("./level-application-upload", () => ({ pickLevelApplicationAttachment: h.pick }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (v: string) => h.records.set(`${ns}:${user}:${id}`, v),
  }),
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/hooks/use-app-active", () => ({
  useScreenActive: () => h.active,
  useAppActiveChange: (fn: (active: boolean) => void) => {
    h.change = fn;
  },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    accessibilityLabel?: string;
    editable?: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={editable === false}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const input = { levelId: 13, crewName: "", crewLink: "", ipName: "", ipLink: "" };
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <LevelApplicationForm userId="user" generation={1} lockedLevelId={13} onClose={h.close} />
      </StrictMode>
    )
  );
const click = (label: string) =>
  act(async () => {
    const node = [...host.querySelectorAll("button")].find(
      (v) => v.getAttribute("aria-label") === label || v.textContent === label
    );
    expect(node, label).toBeDefined();
    node!.click();
  });
beforeEach(() => {
  h.held = [];
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.records.clear();
  h.get.mockImplementation(async (path: string) => {
    if (path === "/user/levels/options")
      return [
        { id: 13, name: "AI Producer" },
        { id: 14, name: "Other level" },
      ];
    if (path === "/user/levels/apply/mine") return [];
    if (path === "/crews/my") return { founded: [{ id: "crew", name: "My Crew" }], joined: [] };
    if (path === "/ip-commerce/me/ips")
      return {
        items: [{ id: "internal-id", title: "My IP", roomNumber: "12345678" }],
        nextCursor: null,
      };
    throw new Error(path);
  });
  h.post.mockResolvedValue({ code: 200 });
  h.pick.mockResolvedValue({ name: "proof.pdf", path: "apply/proof.pdf" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("locks the Crew certification level and submits only after review and confirmation", async () => {
  await render();
  expect(host.textContent).toContain("certificationGuide.producerName");
  expect(host.textContent).not.toContain("Other level");
  await click("levelApplication.review");
  expect(h.post).not.toHaveBeenCalled();
  await click("levelApplication.confirm");
  expect(h.post).toHaveBeenCalledWith(
    "/user/levels/apply",
    expect.objectContaining({ data: input, retry: false })
  );
  expect(host.textContent).toContain("levelApplication.success");
});
it("selects optional associations and a document without substituting an internal IP ID", async () => {
  await render();
  await click("levelApplication.crew");
  await click("My Crew");
  await click("levelApplication.ip");
  await click("My IP");
  await click("levelApplication.attachment");
  expect(host.textContent).toContain("proof.pdf");
  await click("levelApplication.review");
  await click("levelApplication.confirm");
  expect(h.post).toHaveBeenCalledWith(
    "/user/levels/apply",
    expect.objectContaining({
      data: {
        ...input,
        crewName: "My Crew",
        crewLink: "https://fizzdragon.com/en-US/crews/crew",
        ipName: "My IP",
        ipLink: "https://fizzdragon.com/en-US/ip/12345678",
        attachmentUrl: "apply/proof.pdf",
      },
    })
  );
});
it("supports editing the review without submitting", async () => {
  await render();
  await click("levelApplication.review");
  await click("levelApplication.edit");
  expect(host.textContent).toContain("levelApplication.attachment");
  expect(h.post).not.toHaveBeenCalled();
});
it("keeps lost submissions for review across remount and never infers success from an empty list", async () => {
  h.post.mockRejectedValue(new Error("Connection lost"));
  await render();
  await click("levelApplication.review");
  await click("levelApplication.confirm");
  expect(host.textContent).toContain("levelApplication.recovery");
  await act(async () => root.render(null));
  await render();
  expect(host.textContent).toContain("levelApplication.recovery");
  expect(host.textContent).not.toContain("levelApplication.success");
  await click("levelApplication.refresh");
  expect(h.post).toHaveBeenCalledOnce();
  await click("levelApplication.clear");
  expect(host.textContent).toContain("levelApplication.clearHint");
  expect(h.records.get("level-application:user:submit")).not.toBe("null");
  await click("levelApplication.confirmClear");
  expect(h.records.get("level-application:user:submit")).toBe("null");
  expect(h.post).toHaveBeenCalledOnce();
});
it("can review server applications when local recovery storage is corrupt", async () => {
  h.records.set("level-application:user:submit", "{bad");
  await render();
  expect(host.textContent).toContain("levelApplication.recovery");
  expect(host.textContent).toContain("levelApplication.empty");
  expect(h.get).not.toHaveBeenCalledWith("/crews/my", expect.anything());
  expect(h.post).not.toHaveBeenCalled();
});
it("survives a native picker background transition without losing the selected file", async () => {
  let finish!: (v: unknown) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("levelApplication.attachment");
  await act(async () => {
    h.active = false;
    h.change(false);
  });
  await render();
  await act(async () => finish({ name: "proof.pdf", path: "apply/proof.pdf" }));
  await act(async () => {
    h.active = true;
    h.change(true);
  });
  await render();
  expect(host.textContent).toContain("proof.pdf");
  expect(h.post).not.toHaveBeenCalled();
});
it("blocks duplicate pending levels and shows the official status and reviewer remark", async () => {
  const original = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, ...args) =>
    path === "/user/levels/apply/mine"
      ? [{ ...input, id: 22, status: 0, adminRemark: "Awaiting evidence" }]
      : original(path, ...args)
  );
  await render();
  expect(host.textContent).toContain("Awaiting evidence");
  expect(host.textContent).toContain("levelApplication.alreadyPending");
  await click("levelApplication.review");
  expect(h.post).not.toHaveBeenCalled();
});
it("hides the old account's form immediately", async () => {
  await render();
  h.generation = 2;
  await render();
  expect(host.textContent).toBe("");
  expect(h.post).not.toHaveBeenCalled();
});
it("surfaces directory errors and retries explicitly", async () => {
  h.get.mockRejectedValueOnce(new Error("Offline"));
  await render();
  // StrictMode starts a second, current request; fail both reads for a deterministic retry case.
  h.get.mockRejectedValue(new Error("Offline"));
  await act(async () => {
    h.active = false;
    h.change(false);
    h.active = true;
    h.change(true);
  });
  expect(host.textContent).toContain("Offline");
  expect(h.post).not.toHaveBeenCalled();
});

it("blocks an already held certification even if a duplicate application is pending", async () => {
  h.held = [{ id: 13 }];
  await render();
  expect(host.textContent).toContain("levelApplication.alreadyHeld");
  const review = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "levelApplication.review"
  )!;
  expect(review.disabled).toBe(true);
  expect(h.post).not.toHaveBeenCalled();
});
