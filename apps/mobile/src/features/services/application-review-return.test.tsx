import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationReview } from "./application-review";
import { CrewApplications } from "./crew-applications";
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useRouter: () => ({ push: vi.fn() }),
  router: { push: vi.fn() },
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("./user-displays", () => ({ useUserDisplays: () => undefined }));
vi.mock("./position-invitations", () => ({ PositionInvitations: () => null }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000001" },
}));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  focused: true,
  get: vi.fn(),
  post: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
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
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
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
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (amount: string, currency: string) => `${currency} ${amount}`,
}));
const app = {
  id: "app",
  crewId: "crew",
  crewName: "Film crew",
  positionType: "Writer",
  ownerUserId: "manager",
  taskTitle: null,
  dueAt: null,
  positionId: "position",
  taskId: null,
  applicantId: "creator",
  message: "Hello",
  portfolioUrl: null,
  expectedCompensation: null,
  availableStartDate: null,
  yearsExperience: 2,
  status: "pending",
  createdAt: "2026-10-01T00:00:00Z",
  reviewedAt: null,
  reviewerId: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const type = async (key: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(`textarea[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
let fromInbox = false;
let applicant = false;
const render = async () => {
  await act(async () =>
    root.render(
      fromInbox ? (
        <CrewApplications
          userId={applicant ? "creator" : "manager"}
          generation={1}
          initialApplicationId="app"
          onWeb={h.close}
        />
      ) : (
        <ApplicationReview
          active={h.active}
          initialApplicationId="app"
          crewId="crew"
          onWeb={h.close}
          userId="manager"
          generation={1}
          onClose={h.close}
        />
      )
    )
  );
};
const fill = async () => {
  await type("crewTerms.scope", "Storyboards");
  await type("crewTerms.fee", "123.45");
};
const receipt = (data: object) => ({
  id: "00000000-0000-4000-8000-000000000001",
  applicationId: "app",
  version: 1,
  ...data,
  proposedByUserId: "manager",
  createdAt: app.createdAt,
  confirmedAt: null,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  fromInbox = false;
  applicant = false;
  h.get.mockImplementation(async (path) =>
    path.endsWith("/positions")
      ? { items: [{ id: "position", crewId: "crew", taskId: null }], nextCursor: null }
      : path.endsWith("/terms")
        ? { currentVersion: 0, items: [], nextBeforeVersion: null }
        : path.endsWith("/interview")
          ? {
              applicationStatus: "pending",
              canUpdate: true,
              canMessage: true,
              version: 0,
              state: "not_started",
              scheduledAt: null,
              items: [],
              nextBeforeVersion: null,
            }
          : app
  );
  h.post.mockImplementation(async (_path, options) => receipt(options.data));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it.each([false, true])(
  "retains a terms draft through background and access failure (inbox=%s)",
  async (inbox) => {
    fromInbox = inbox;
    await render();
    await click("termsProposal.open");
    await fill();
    h.active = false;
    await render();
    expect(host.textContent).toBe("");
    const original = h.get.getMockImplementation()!;
    h.get.mockRejectedValue(new Error("Access recheck failed"));
    h.active = true;
    await render();
    expect(host.textContent).toContain("Access recheck failed");
    expect(button("crewTerms.propose")).toBeUndefined();
    h.get.mockImplementation(original);
    await click("common.retry");
    expect(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewTerms.scope"]')?.value
    ).toBe("Storyboards");
    expect(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewTerms.fee"]')?.value
    ).toBe("123.45");
    expect(h.post).not.toHaveBeenCalled();
    await click("crewTerms.propose");
    expect(h.post).toHaveBeenCalledTimes(1);
  }
);
it.each([false, true])(
  "retains unsent interview notes through background (inbox=%s)",
  async (inbox) => {
    fromInbox = inbox;
    await render();
    await click("reviewerInterview.open");
    await type("crewInterview.messageLabel", "Discuss delivery timing");
    h.active = false;
    await render();
    expect(host.textContent).toBe("");
    const reads = h.get.mock.calls.length;
    h.active = true;
    await render();
    expect(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewInterview.messageLabel"]')
        ?.value
    ).toBe("Discuss delivery timing");
    expect(h.get.mock.calls.length).toBeGreaterThan(reads);
    expect(h.post).not.toHaveBeenCalled();
  }
);
it.each(["route", "account"])("retires an unsent terms draft on %s change", async (change) => {
  await render();
  await click("termsProposal.open");
  await fill();
  if (change === "route") h.focused = false;
  else h.generation = 2;
  await render();
  expect(host.textContent).toBe("");
  h.focused = true;
  h.generation = 1;
  await render();
  await click("termsProposal.open");
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewTerms.scope"]')?.value
  ).toBe("");
});

it("keeps an uncertain terms request immutable across foreground refresh", async () => {
  await render();
  await click("termsProposal.open");
  await fill();
  h.post.mockRejectedValueOnce(new Error("Response lost"));
  await click("crewTerms.propose");
  const sent = h.post.mock.calls[0];
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("termsProposal.retry");
  expect(h.post.mock.calls[1]).toEqual(sent);
});

it("preserves the applicant interview draft when returning from background", async () => {
  fromInbox = true;
  applicant = true;
  await render();
  await click("crewInterview.title");
  await type("crewInterview.messageLabel", "Available after Monday");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewInterview.messageLabel"]')
      ?.value
  ).toBe("Available after Monday");
  expect(h.post).not.toHaveBeenCalled();
});
