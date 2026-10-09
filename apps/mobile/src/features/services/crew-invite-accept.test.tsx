import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewInviteAccept } from "./crew-invite-accept";
import { CrewInviteAcceptError } from "./crew-invite-accept-api";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  preview: vi.fn(),
  accept: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (s: string) => s }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./crew-invite-accept-api", async (original) => ({
  ...(await original<typeof import("./crew-invite-accept-api")>()),
  previewCrewInvite: h.preview,
  acceptCrewInvite: h.accept,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} onChange={(e) => onChangeText(e.target.value)} disabled={!editable} />,
}));
const token = "a".repeat(32),
  id = "11111111-1111-4111-8111-111111111111";
const preview = {
  scope: "crew",
  targetName: "Team",
  crewId: id,
  logo: null,
  tagline: null,
  memberCount: 2,
  status: "active",
  expiresAt: null,
};
const target = { scope: "crew", crewId: id, memberId: "member1", targetName: "Team" };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = (initialLink?: string) =>
  act(async () =>
    root.render(
      <CrewInviteAccept
        initialLink={initialLink}
        generation={1}
        onOpen={h.open}
        onClose={h.close}
      />
    )
  );
const button = (s: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === s);
const click = (s: string) => act(async () => button(s)!.click());
const input = (value: string) =>
  act(async () => {
    const el = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const load = async () => {
  await render();
  await input(`https://fizzdragon.com/crew-invite/${token}`);
  await click("crewJoin.preview");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.preview.mockResolvedValue(preview);
  h.accept.mockResolvedValue(target);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("previews before joining and opens only the confirmed target on request", async () => {
  await load();
  expect(host.textContent).toContain("Team");
  expect(h.accept).not.toHaveBeenCalled();
  await act(async () => {
    button("crewJoin.accept")!.click();
    button("crewJoin.accept")!.click();
  });
  expect(h.accept).toHaveBeenCalledTimes(1);
  expect(h.open).not.toHaveBeenCalled();
  await click("crewJoin.open");
  expect(h.open).toHaveBeenCalledWith(target);
});
it("rejects foreign-region links before a request", async () => {
  await render();
  await input(`https://fizzdragon.fizzspace.cn/crew-invite/${token}`);
  await click("crewJoin.preview");
  expect(h.preview).not.toHaveBeenCalled();
});
it("offers explicit idempotent recovery after a lost response", async () => {
  h.accept.mockRejectedValue(new CrewInviteAcceptError("Lost response"));
  await load();
  await click("crewJoin.accept");
  expect(host.textContent).toContain("crewJoin.uncertain");
  expect(h.accept).toHaveBeenCalledTimes(1);
  h.accept.mockResolvedValue(target);
  await click("crewJoin.recover");
  expect(h.accept.mock.calls[1][4]).toBe(true);
  expect(host.textContent).not.toContain("crewJoin.uncertain");
});
it("offers only existing-access recovery for expired links", async () => {
  h.preview.mockResolvedValue({ ...preview, status: "expired" });
  await load();
  expect(button("crewJoin.accept")).toBeUndefined();
  await click("crewJoin.recover");
  expect(h.accept.mock.calls[0][4]).toBe(true);
});
it("invalidates preview when the link changes or app backgrounds", async () => {
  await load();
  await input("different");
  expect(button("crewJoin.accept")).toBeUndefined();
  await load();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(button("crewJoin.accept")).toBeUndefined();
});
it("hides pending results when the account changes", async () => {
  await load();
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});

it("prefills a routed invite without joining and clears the previous review for a new link", async () => {
  const first = `https://fizzdragon.com/crew-invite/${token}`;
  await render(first);
  expect(host.querySelector("input")!.value).toBe(first);
  expect(h.accept).not.toHaveBeenCalled();
  await click("crewJoin.preview");
  expect(host.textContent).toContain("Team");
  const second = `https://fizzdragon.com/crew-invite/${"b".repeat(32)}`;
  await render(second);
  expect(host.querySelector("input")!.value).toBe(second);
  expect(button("crewJoin.accept")).toBeUndefined();
  expect(h.accept).not.toHaveBeenCalled();
});

vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
