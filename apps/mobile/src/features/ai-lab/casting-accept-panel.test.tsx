import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CastingAcceptPanel } from "./casting-accept-panel";

const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  push: vi.fn(),
  review: vi.fn(),
  prepare: vi.fn(),
  accept: vi.fn(),
  pending: null as null | { clientKey: string; projectName: string; characterName: string },
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "acceptance-key" } }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/features/crew-assets/api", () => ({ fetchCrewAssetAccess: vi.fn() }));
vi.mock("./character-library-api", () => ({ ENROLLMENT_CONSENT_VERSION: "enrollment" }));
vi.mock("./casting-accept-api", () => ({
  PROJECT_LIKENESS_CONSENT_VERSION: "project-consent",
  castingAcceptanceBox: () => ({ read: () => h.pending }),
  reviewCastingInvite: h.review,
  prepareCastingAcceptance: h.prepare,
  acceptCastingInvitation: h.accept,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children, testID, onScroll }: any) => (
    <div
      data-testid={testID}
      onScroll={() =>
        onScroll?.({
          nativeEvent: {
            layoutMeasurement: { height: 300 },
            contentOffset: { y: 700 },
            contentSize: { height: 1000 },
          },
        })
      }
    >
      {children}
    </div>
  ),
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress, disabled, accessibilityRole, accessibilityState }: any) => (
    <button
      role={accessibilityRole}
      disabled={disabled}
      onClick={onPress}
      aria-checked={accessibilityState?.checked}
      aria-selected={accessibilityState?.selected}
    >
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const token = "a".repeat(32);
const review = (verified = false) => ({
  preview: { projectName: "Invitation project" },
  workspaceId: "personal",
  likenesses: verified
    ? [{ id: "likeness", name: "My verified likeness", coverAssetId: null }]
    : [],
});
const render = () =>
  act(async () => root.render(<CastingAcceptPanel token={token} userId="actor" generation={1} />));
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
async function returnToInvitation() {
  h.active = false;
  await render();
  h.active = true;
  await render();
}
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.pending = null;
  h.review.mockResolvedValue(review());
  h.prepare.mockReturnValue({ clientKey: "acceptance-key" });
  h.accept.mockResolvedValue(undefined);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("opens the native library and reloads the same invitation on return, requiring fresh consent", async () => {
  await render();
  await click("castingAccept.enroll");
  expect(h.push).toHaveBeenCalledExactlyOnceWith("/character-library");
  h.review.mockResolvedValue(review(true));
  await returnToInvitation();
  expect(h.review).toHaveBeenLastCalledWith(token, 1, expect.any(AbortSignal));
  expect(h.review).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("My verified likeness");
  expect(button("castingAccept.reviewConsent")).toBeUndefined();
  expect(h.accept).not.toHaveBeenCalled();
  await click("My verified likeness");
  await click("castingAccept.reviewConsent");
  expect(button("castingAccept.accept").disabled).toBe(true);
  await act(async () =>
    host
      .querySelector('[role="checkbox"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }))
  );
  expect(button("castingAccept.accept").disabled).toBe(true);
  await act(async () =>
    host.querySelector('[data-testid="casting-consent-copy"]')!.dispatchEvent(new Event("scroll"))
  );
  await click("castingAccept.accept");
  expect(h.prepare).toHaveBeenCalledWith(
    token,
    review(true),
    "likeness",
    "acceptance-key",
    true,
    true
  );
  expect(h.accept).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("castingAccept.done");
});
it("keeps enrollment available when verification was cancelled or remains pending", async () => {
  await render();
  await click("castingAccept.enroll");
  await returnToInvitation();
  expect(button("castingAccept.enroll")).toBeDefined();
  expect(h.accept).not.toHaveBeenCalled();
});
it("shows invitation revocation discovered while enrollment was open", async () => {
  await render();
  await click("castingAccept.enroll");
  h.review.mockRejectedValue(new Error("This casting invitation is no longer available."));
  await returnToInvitation();
  expect(host.textContent).toContain("This casting invitation is no longer available.");
  expect(button("castingAccept.enroll")).toBeUndefined();
  expect(h.accept).not.toHaveBeenCalled();
});
it("preserves uncertain acceptance across return without offering enrollment or resubmitting", async () => {
  h.pending = { clientKey: "old", projectName: "Invitation project", characterName: "My likeness" };
  await render();
  await returnToInvitation();
  expect(host.textContent).toContain("castingAccept.pending");
  expect(button("castingAccept.enroll")).toBeUndefined();
  expect(h.accept).not.toHaveBeenCalled();
});
it("rejects enrollment after an account change and hides the inactive invitation", async () => {
  await render();
  h.generation = 2;
  await click("castingAccept.enroll");
  expect(h.push).not.toHaveBeenCalled();
  h.generation = 1;
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});
