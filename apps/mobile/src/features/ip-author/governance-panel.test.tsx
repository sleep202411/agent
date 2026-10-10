import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpGovernancePanel } from "./governance-panel";
const h = vi.hoisted(() => ({
  signedIn: true,
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  push: vi.fn(),
  key: 10,
  open: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, patch: h.patch, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.key).padStart(12, "0")}` },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children, style }: { children: ReactNode; style?: { display?: "none" | "flex" } }) => (
    <div style={{ display: style?.display }}>{children}</div>
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
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
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: h.push }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => (
      <>{options.headerRight?.()}</>
    ),
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.signedIn ? "authenticated" : "anonymous",
    user: { userId: "alice" },
    generation: 1,
  }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/ip-author/contributors-panel", () => ({ IpContributorsPanel: () => null }));
const id = "11111111-1111-4111-8111-111111111111";
let profile: {
  id: string;
  title: string;
  version: number;
  copyrightOwner: string;
  rightsSummary: { statement: string };
  aiDisclosure: { generatedVisuals: boolean; generatedCopy: boolean; statement: string };
};
let links: { label: string; url: string }[];
let crewId: string | null;
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpGovernancePanel ipId={id} userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const input = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (label: string, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(label),
      value
    );
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  profile = {
    id,
    title: "Story",
    version: 1,
    copyrightOwner: "Alice",
    rightsSummary: { statement: "Original story" },
    aiDisclosure: { generatedVisuals: false, generatedCopy: false, statement: "" },
  };
  links = [];
  crewId = "old-crew";
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/release-links")
      ? { links, version: profile.version }
      : path.endsWith("/crew")
        ? {
            crewId,
            version: profile.version,
            choices: [{ id: "new-crew", name: "Production team" }],
          }
        : { ip: profile }
  );
  h.put.mockImplementation(async (path: string, { data }: { data: Record<string, unknown> }) => {
    profile = { ...profile, version: profile.version + 1 };
    if (path.endsWith("/release-links")) {
      links = data.links as typeof links;
      return { links, version: profile.version };
    }
    if (path.endsWith("/crew")) {
      crewId = data.crewId as string | null;
      return {
        crewId,
        version: profile.version,
        choices: [{ id: "new-crew", name: "Production team" }],
      };
    }
    profile = { ...profile, ...data, version: profile.version };
    return { ip: profile };
  });
  h.open.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("saves disclosure fields without overwriting profile content", async () => {
  await mount();
  await type("ipGovernance.copyrightOwner", "New owner");
  await click("☐ ipGovernance.generatedVisuals");
  await type("ipGovernance.aiStatement", "Assisted backgrounds");
  await click("ipGovernance.save");
  expect(h.put).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      data: {
        copyrightOwner: "New owner",
        rightsSummary: { statement: "Original story" },
        aiDisclosure: {
          generatedVisuals: true,
          generatedCopy: false,
          statement: "Assisted backgrounds",
        },
        expectedVersion: 1,
      },
    })
  );
  expect(host.textContent).toContain("ipGovernance.saved");
});
it("validates links before saving or opening and saves removal", async () => {
  await mount();
  await click("ipGovernance.links");
  await click("ipGovernance.addLink");
  await type("ipGovernance.label 1", "Watch");
  await type("ipGovernance.url 1", "http://example.com");
  expect(button("ipGovernance.save").disabled).toBe(true);
  expect(button("ipGovernance.openLink").disabled).toBe(true);
  await type("ipGovernance.url 1", "https://example.com/watch");
  await click("ipGovernance.openLink");
  expect(h.open).toHaveBeenCalledWith("https://example.com/watch");
  await click("ipGovernance.save");
  expect(links).toEqual([{ label: "Watch", url: "https://example.com/watch" }]);
  await click("ipGovernance.removeLink");
  await click("ipGovernance.save");
  expect(links).toEqual([]);
});
it("preserves an existing Crew outside choices until explicitly changed or unlinked", async () => {
  await mount();
  await click("ipGovernance.crew");
  expect(button("● ipGovernance.existingCrew")).toBeDefined();
  expect(button("ipGovernance.save").disabled).toBe(true);
  await click("○ Production team");
  await click("ipGovernance.save");
  expect(crewId).toBe("new-crew");
  await click("○ ipGovernance.noCrew");
  await click("ipGovernance.save");
  expect(crewId).toBeNull();
});
it("recovers a lost receipt after remount without another write and freezes the pending payload", async () => {
  h.put.mockImplementation(async () => {
    profile = { ...profile, copyrightOwner: "Changed", version: 2 };
    throw new Error("Lost reply");
  });
  await mount();
  await type("ipGovernance.copyrightOwner", "Changed");
  await click("ipGovernance.save");
  expect(input("ipGovernance.copyrightOwner").readOnly).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  await click("common.retry");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipGovernance.saved");
  expect(host.textContent).not.toContain("ipGovernance.pending");
});
it("shows latest conflicting values and requires confirmation before applying the original pending change", async () => {
  await mount();
  await type("ipGovernance.copyrightOwner", "Mine");
  profile = { ...profile, copyrightOwner: "Other editor", version: 2 };
  await click("ipGovernance.save");
  expect(h.put).not.toHaveBeenCalled();
  await click("ipGovernance.refresh");
  expect(host.textContent).toContain("Other editor");
  expect(input("ipGovernance.copyrightOwner").value).toBe("Mine");
  await click("ipGovernance.reviewApply");
  expect(h.put).not.toHaveBeenCalled();
  await click("common.cancel");
  await click("ipGovernance.reviewApply");
  await click("ipGovernance.confirmApply");
  expect(h.put).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      data: expect.objectContaining({ copyrightOwner: "Mine", expectedVersion: 2 }),
    })
  );
});
it("can explicitly discard local intent after reviewing server values without a write", async () => {
  await mount();
  await type("ipGovernance.copyrightOwner", "Mine");
  profile = { ...profile, copyrightOwner: "Other editor", version: 2 };
  await click("ipGovernance.save");
  await click("ipGovernance.refresh");
  await click("ipGovernance.useSaved");
  await click("ipGovernance.confirmDiscard");
  expect(input("ipGovernance.copyrightOwner").value).toBe("Other editor");
  expect(h.put).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("ipGovernance.pending");
});
it("hides private forms after access loss, inactivity or authentication changes", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "Access removed", 403));
  await click("ipGovernance.refresh");
  expect(input("ipGovernance.copyrightOwner")).toBeNull();
  expect(host.textContent).toContain("Access removed");
  h.active = false;
  await mount();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
  h.active = true;
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});

it("opens Crew linking with the requested permitted Crew without an automatic write", async () => {
  await act(async () =>
    root.render(
      <IpGovernancePanel
        ipId={id}
        userId="alice"
        generation={1}
        initialKind="crew"
        suggestedCrewId="new-crew"
      />
    )
  );
  expect(button("● Production team")).toBeDefined();
  expect(host.textContent).toContain("crewLinks.linkedElsewhere");
  expect(h.put).not.toHaveBeenCalled();
  await click("ipGovernance.save");
  expect(crewId).toBe("new-crew");
});
it("does not preselect a Crew outside the server's choices", async () => {
  await act(async () =>
    root.render(
      <IpGovernancePanel
        ipId={id}
        userId="alice"
        generation={1}
        initialKind="crew"
        suggestedCrewId="forbidden"
      />
    )
  );
  expect(button("● ipGovernance.existingCrew")).toBeDefined();
  expect(button("ipGovernance.save").disabled).toBe(true);
  expect(h.put).not.toHaveBeenCalled();
});

it("preserves a pending Crew write when returning from a different link entry", async () => {
  h.put.mockRejectedValue(new Error("Response lost"));
  await act(async () =>
    root.render(
      <IpGovernancePanel
        ipId={id}
        userId="alice"
        generation={1}
        initialKind="crew"
        suggestedCrewId="new-crew"
      />
    )
  );
  await click("ipGovernance.save");
  expect(h.put).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () =>
    root.render(
      <IpGovernancePanel
        ipId={id}
        userId="alice"
        generation={1}
        initialKind="crew"
        suggestedCrewId="other-crew"
      />
    )
  );
  expect(button("● Production team")).toBeDefined();
  expect(host.textContent).toContain("ipGovernance.pending");
  expect(h.put).toHaveBeenCalledTimes(1);
});

it("retains unsent disclosure and link edits across background without submitting", async () => {
  await mount();
  await type("ipGovernance.copyrightOwner", "New studio");
  h.active = false;
  await mount();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
  await click("ipGovernance.save");
  expect(h.put).not.toHaveBeenCalled();
  h.active = true;
  await mount();
  expect(input("ipGovernance.copyrightOwner").value).toBe("New studio");
  await click("ipGovernance.save");
  expect(profile.copyrightOwner).toBe("New studio");
  await click("ipGovernance.links");
  await click("ipGovernance.addLink");
  await type("ipGovernance.label 1", "Watch");
  await type("ipGovernance.url 1", "https://example.com/watch");
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(input("ipGovernance.label 1").value).toBe("Watch");
  expect(input("ipGovernance.url 1").value).toBe("https://example.com/watch");
  await click("ipGovernance.save");
  expect(links).toEqual([{ label: "Watch", url: "https://example.com/watch" }]);
});
it("retires unsent forms on route exit", async () => {
  await mount();
  await type("ipGovernance.copyrightOwner", "Unsent");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(input("ipGovernance.copyrightOwner").value).toBe("Alice");
  expect(h.put).not.toHaveBeenCalled();
});
it("rechecks access before saving a draft retained through background", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  await type("ipGovernance.copyrightOwner", "Unsent");
  h.active = false;
  await mount();
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "Access removed", 403));
  h.active = true;
  await mount();
  await click("ipGovernance.save");
  expect(h.put).not.toHaveBeenCalled();
  expect(input("ipGovernance.copyrightOwner")).toBeNull();
  expect(host.textContent).toContain("Access removed");
});
