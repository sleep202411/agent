import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DiscoveryAssistantPanel } from "./discovery-assistant-panel";
import { discoveryPending, type AssistantScope } from "./discovery-assistant-api";
import { emptyStudioQuery } from "./studio-search-api";
import { ApiRequestError } from "@/lib/api-client";
const h = vi.hoisted(() => ({
  login: vi.fn(),
  review: vi.fn(),
  apply: vi.fn(),
  select: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  generation: 1,
  active: true,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ requireAuth: h.login }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, u: string, id: string) => ({
    read: () => h.records.get(ns + u + id) ?? null,
    write: (s: string) => h.records.set(ns + u + id, s),
  }),
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
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Switch: ({
    value,
    onValueChange,
    disabled,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
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
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const scope: AssistantScope = {
  userId: "viewer",
  generation: 1,
  locale: "en-US",
  kind: "creators",
};
const id = "11111111-1111-4111-8111-111111111111";
const saved = {
  requestId: id,
  locale: "en-US" as const,
  conversation: {
    current: { kind: "creators" as const, query: emptyStudioQuery },
    messages: [{ role: "user" as const, content: "Find a remote studio" }],
  },
};
const proposal = {
  requestId: id,
  status: "succeeded",
  result: {
    status: "results",
    kind: "creators",
    queryId: "a".repeat(64),
    query: { ...emptyStudioQuery, remoteOnly: true },
    matchedCount: 1,
    accessibleCount: 2,
    requiresLogin: false,
    countScope: "public_platform_creators_with_listed_services",
    cards: [
      {
        id: "studio",
        name: "Matching studio",
        avatarUrl: "",
        openToWork: true,
        matched: true,
        basedIn: null,
        serves: [],
        remote: true,
        showOnMap: false,
        point: null,
        serviceCount: 2,
        matchingServiceCount: 1,
      },
    ],
  },
};
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === key)!;
const click = async (key: string) => act(async () => button(key).click());
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
const render = (s = scope, valid = true) =>
  act(async () =>
    root.render(
      <StrictMode>
        <DiscoveryAssistantPanel
          key={s.generation + ":" + s.userId}
          scope={s}
          current={{ kind: "creators", query: emptyStudioQuery }}
          valid={valid}
          onReview={h.review}
          onApply={h.apply}
          onSelect={h.select}
        />
      </StrictMode>
    )
  );
const open = async () => {
  await render();
  await click("discoveryAssistant.title");
  await settle();
};
const type = async (text: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="discoveryAssistant.prompt"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.active = true;
  h.post.mockResolvedValue(proposal);
  h.get.mockResolvedValue(proposal);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("keeps guest search usable and gates only the explicitly opened assistant", async () => {
  await render({ ...scope, userId: "" });
  expect(h.get).not.toHaveBeenCalled();
  await click("discoveryAssistant.title");
  expect(host.textContent).toContain("discoveryAssistant.loginHint");
  await click("discoveryAssistant.login");
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.post).not.toHaveBeenCalled();
});
it("does not auto-send on opening/restoration, and never applies a proposal without a fresh explicit action", async () => {
  discoveryPending(scope).save(saved);
  await open();
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  await click("discoveryAssistant.check");
  expect(host.textContent).toContain("Matching studio");
  expect(h.apply).not.toHaveBeenCalled();
  expect(h.review).not.toHaveBeenCalled();
  await click("discoveryAssistant.review");
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(h.review).toHaveBeenCalledExactlyOnceWith(proposal.result);
  expect(h.apply).not.toHaveBeenCalled();
  await click("discoveryAssistant.title");
  await settle();
  await click("discoveryAssistant.check");
  await click("discoveryAssistant.applyResults");
  expect(h.apply).toHaveBeenCalledExactlyOnceWith(proposal.result);
  expect(h.post).not.toHaveBeenCalled();
});
it("persists explicit sends, recovers a lost reply after closing and exposes identical retry only after 404", async () => {
  await open();
  await type("Find a remote studio");
  h.post.mockRejectedValueOnce(Error("Reply lost"));
  await click("discoveryAssistant.send");
  expect(h.post).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Reply lost");
  const original = h.post.mock.calls[0][1].data;
  await click("discoveryAssistant.close");
  await click("discoveryAssistant.title");
  await settle();
  expect(h.post).toHaveBeenCalledOnce();
  expect(button("discoveryAssistant.retry")).toBeUndefined();
  h.get.mockRejectedValueOnce(new ApiRequestError("MISSING", "Not found", 404));
  await click("discoveryAssistant.check");
  expect(button("discoveryAssistant.retry")).toBeDefined();
  h.get.mockRejectedValueOnce(new ApiRequestError("MISSING", "Not found", 404));
  await click("discoveryAssistant.retry");
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post.mock.calls[1][1].data).toEqual(original);
});
it("does not navigate to a recommendation removed by a fresh receipt", async () => {
  discoveryPending(scope).save(saved);
  await open();
  await click("discoveryAssistant.check");
  h.get.mockResolvedValueOnce({
    ...proposal,
    result: { ...proposal.result, cards: [], matchedCount: 0 },
  });
  await click("studioDiscovery.viewStudio");
  expect(h.select).not.toHaveBeenCalled();
  expect(host.textContent).toContain("studioDiscovery.selectionUnavailable");
  expect(host.textContent).not.toContain("Matching studio");
});
it("hides denied results and transcript, and rechecks permissions without another model turn", async () => {
  discoveryPending(scope).save(saved);
  await open();
  await click("discoveryAssistant.check");
  h.get.mockRejectedValueOnce(new ApiRequestError("DENIED", "Permission changed", 403));
  await click("discoveryAssistant.applyResults");
  expect(host.textContent).toContain("Permission changed");
  expect(host.textContent).not.toContain("Matching studio");
  expect(host.textContent).not.toContain("Find a remote studio");
  expect(h.apply).not.toHaveBeenCalled();
  await click("discoveryAssistant.check");
  expect(host.textContent).toContain("Matching studio");
  expect(h.post).not.toHaveBeenCalled();
});
it("requires confirmation to clear an uncertain conversation and never calls cancellation implicitly", async () => {
  discoveryPending(scope).save(saved);
  h.get.mockResolvedValueOnce({ requestId: id, status: "uncertain", result: null });
  await open();
  await click("discoveryAssistant.check");
  await type("Another request");
  expect(button("discoveryAssistant.send").disabled).toBe(true);
  await click("discoveryAssistant.newConversation");
  expect(discoveryPending(scope).read()).toEqual(saved);
  await click("common.cancel");
  expect(discoveryPending(scope).read()).toEqual(saved);
  await click("discoveryAssistant.newConversation");
  await click("discoveryAssistant.confirmNew");
  expect(discoveryPending(scope).read()).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
it("allows explicit cancellation while sending and ignores its late response", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await open();
  await type("Find a remote studio");
  await click("discoveryAssistant.send");
  h.post.mockResolvedValueOnce({ requestId: id, status: "cancelled", result: null });
  await click("discoveryAssistant.cancel");
  expect(h.post.mock.calls[0][1].signal.aborted).toBe(true);
  expect(host.textContent).toContain("discoveryAssistant.cancelled");
  await act(async () => resolve(proposal));
  expect(host.textContent).not.toContain("Matching studio");
  expect(discoveryPending(scope).read()?.requestId).toBe(id);
});
it("disables invalid filters and aborts a backgrounded check without applying late results", async () => {
  await open();
  await type("Find a studio");
  await render(scope, false);
  expect(button("discoveryAssistant.send").disabled).toBe(true);
  expect(host.textContent).toContain("discoveryAssistant.invalidConditions");
  await click("discoveryAssistant.close");
  discoveryPending(scope).save(saved);
  await render();
  await click("discoveryAssistant.title");
  await settle();
  let resolve!: (v: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await click("discoveryAssistant.check");
  h.active = false;
  await render();
  expect(h.get.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => resolve(proposal));
  expect(host.textContent).not.toContain("Matching studio");
  h.active = true;
  await render();
  await click("discoveryAssistant.check");
  expect(host.textContent).toContain("Matching studio");
  h.generation = 2;
  await render({ ...scope, userId: "other", generation: 2 });
  expect(host.textContent).not.toContain("Matching studio");
  expect(h.post).not.toHaveBeenCalled();
});
it("offers exact retry if a previously denied request is now read-confirmed missing", async () => {
  discoveryPending(scope).save(saved);
  await open();
  h.get.mockRejectedValueOnce(new ApiRequestError("DENIED", "Permission changed", 403));
  await click("discoveryAssistant.check");
  h.get.mockRejectedValueOnce(new ApiRequestError("MISSING", "Not found", 404));
  await click("discoveryAssistant.check");
  expect(button("discoveryAssistant.retry").disabled).toBe(false);
  h.get.mockRejectedValueOnce(new ApiRequestError("MISSING", "Not found", 404));
  await click("discoveryAssistant.retry");
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.post.mock.calls[0][1].data).toEqual(saved);
});
