import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewInviteLinks } from "./crew-invite-links";
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  active: true,
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  share: vi.fn(),
  close: vi.fn(),
  records: new Map<string, string>(),
  permissions: ["members.invite", "members.permissions.manage"],
}));
vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.detail }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (n: string, u: string, c: string) => ({
    read: () => h.records.get(n + u + c) ?? null,
    write: (s: string) => h.records.set(n + u + c, s),
  }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Share: { share: h.share },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  kind: "member",
  policyKeys: [],
  maxUses: null,
  useCount: 0,
  expiresAt: null,
  createdAt: "2026-10-02T00:00:00Z",
  createdByUserId: "actor",
  state: "active",
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <CrewInviteLinks crewId="crew" userId="actor" generation={1} onClose={h.close} />
      </StrictMode>
    )
  );
const button = (s: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === s);
const click = (s: string) => act(async () => button(s)!.click());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.records.clear();
  h.permissions = ["members.invite", "members.permissions.manage"];
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me") ? { userId: "actor", permissions: h.permissions } : [row]
  );
  h.post.mockResolvedValue({ ...row, token: "a".repeat(32) });
  h.delete.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads under StrictMode and requires review plus explicit creation", async () => {
  await render();
  expect(button("crewLinks.review")?.disabled).toBe(false);
  expect(h.post).not.toHaveBeenCalled();
  await click("crewLinks.review");
  await act(async () => {
    button("crewLinks.create")!.click();
    button("crewLinks.create")!.click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("https://fizzdragon.com/crew-invite/");
});
it("withholds privileged presets when the viewer only has invite access", async () => {
  h.permissions = ["members.invite"];
  await render();
  expect(button("crewMembers.admin")).toBeUndefined();
  await click("crewLinks.review");
  await click("crewLinks.create");
  expect(h.post.mock.calls[0][1].data.policyKeys).toEqual([]);
});
it("does not create after permission loss between review and confirmation", async () => {
  await render();
  await click("crewLinks.review");
  h.permissions = [];
  await click("crewLinks.create");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("permission");
});
it("restores uncertain creation after remount and blocks automatic replay", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await render();
  await click("crewLinks.review");
  await click("crewLinks.create");
  expect(host.textContent).toContain("crewLinks.pending");
  await act(async () => root.render(null));
  await render();
  expect(button("crewLinks.review")).toBeUndefined();
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("crewLinks.clear");
  expect(button("crewLinks.review")).toBeUndefined();
  await click("crewLinks.confirmClear");
  expect(button("crewLinks.review")).toBeDefined();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("requires explicit revocation confirmation", async () => {
  await render();
  await click("crewLinks.revoke");
  expect(h.delete).not.toHaveBeenCalled();
  await click("crewLinks.confirmRevoke");
  expect(h.delete).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("crewLinks.revoked");
});
it("does not share when a freshly fetched link is expired", async () => {
  await render();
  await click("crewLinks.review");
  await click("crewLinks.create");
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: h.permissions }
      : [{ ...row, state: "expired" }]
  );
  await click("crewLinks.share");
  expect(h.share).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("https://fizzdragon.com/crew-invite/");
});
it("hides account-scoped links after an account change", async () => {
  await render();
  await click("crewLinks.review");
  await click("crewLinks.create");
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});
it("blocks mutation when saved request data is corrupt", async () => {
  h.records.set("crew-invite-linkactorcrew", "bad");
  await render();
  expect(host.textContent).toContain("crewLinks.pending");
  expect(button("crewLinks.review")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
});

it("retains the one-time link in memory while the share sheet backgrounds the screen", async () => {
  await render();
  await click("crewLinks.review");
  await click("crewLinks.create");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(host.textContent).toContain("https://fizzdragon.com/crew-invite/");
  expect(h.post).toHaveBeenCalledTimes(1);
});

it("locks task invitation controls to one-use member access without policy grants", async () => {
  const taskId = "00000000-0000-4000-8000-000000000001";
  h.permissions = ["members.invite", "members.permissions.manage", "tasks.manage"];
  h.detail.mockResolvedValue({ version: 3, isRecruiting: false, assignees: [], status: "open" });
  h.post.mockResolvedValue({
    ...row,
    taskId,
    taskVersion: 3,
    maxUses: 1,
    policyKeys: [],
    token: "a".repeat(32),
  });
  await act(async () =>
    root.render(
      <CrewInviteLinks
        crewId="crew"
        userId="actor"
        generation={1}
        task={{ id: taskId, version: 3, title: "Pilot" }}
        onClose={h.close}
      />
    )
  );
  expect(host.textContent).not.toContain("crewLinks.maxUses");
  expect(host.textContent).not.toContain("crewMembers.admin");
  expect(host.textContent).toContain("workspace.taskInviteIntro");
  await click("crewLinks.review");
  await click("crewLinks.create");
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    taskId,
    taskVersion: 3,
    kind: "member",
    maxUses: 1,
    policyKeys: [],
  });
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: h.permissions }
      : [{ ...row, taskId, taskVersion: 3, maxUses: 1, policyKeys: [] }]
  );
  await click("crewLinks.share");
  expect(h.share).toHaveBeenCalledWith({
    message: `https://fizzdragon.com/crew-invite/${"a".repeat(32)}`,
  });
});
