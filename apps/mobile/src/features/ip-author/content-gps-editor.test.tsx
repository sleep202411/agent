import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ContentGpsEditor } from "./content-gps-editor";
import { ApiRequestError } from "@/lib/api-client";
const h = vi.hoisted(() => ({
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
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "story_setting",
  label: "Singapore",
  status: "unresolved",
  point: null,
};
let revision = { version: 1, locations: [row], requestId: row.id };
const suggestion = {
  ...row,
  id: "suggestion-1",
  label: "Tokyo",
  evidence: [
    { sourceType: "ip_localization", field: "description", quote: "The story opens in Tokyo." },
  ],
};
const suggestions = {
  state: "ready",
  analysisVersion: "v1",
  analyzedAt: "2026-10-01T00:00:00.000Z",
  ownerVersion: 1,
  locations: [suggestion],
};
const receipt = {
  id,
  status: "succeeded",
  analysisVersion: "v1",
  sourceFingerprint: "a".repeat(64),
  createdAt: "2026-10-01T00:00:00.000Z",
  finishedAt: "2026-10-01T00:01:00.000Z",
};
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === key)!;
const click = async (key: string) => act(async () => button(key).click());
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <ContentGpsEditor scope={{ ipId: id, userId: "owner", generation: 1, locale: "en-US" }} />
      </StrictMode>
    )
  );
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
const open = async () => {
  await render();
  await settle();
};
const firstInput = () => host.querySelector<HTMLInputElement>("input")!;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.active = true;
  revision = { version: 1, locations: [row], requestId: row.id };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/suggestions") ? suggestions : path.includes("/analysis/") ? receipt : revision
  );
  h.put.mockImplementation(async (_p, { data }) => {
    revision = {
      version: data.expectedVersion + 1,
      locations: data.locations,
      requestId: data.requestId,
    };
    return revision;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads owner data, keeps AI collapsed and saves an explicit empty override without automatic analysis", async () => {
  await open();
  expect(firstInput().value).toBe("Singapore");
  expect(button("contentGpsSuggestions.analyze")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
  await click("contentGpsOwner.remove");
  await click("contentGpsOwner.save");
  expect(h.put.mock.calls[0][1].data.locations).toEqual([]);
  expect(host.textContent).toContain("contentGpsOwner.saved");
});
it("locks a lost save, restores it after remount and retries the exact request", async () => {
  await open();
  await click("contentGpsOwner.remove");
  h.put.mockRejectedValueOnce(Error("Reply lost"));
  await click("contentGpsOwner.save");
  expect(host.textContent).toContain("Reply lost");
  const first = h.put.mock.calls[0][1].data;
  await act(async () => root.unmount());
  root = createRoot(host);
  await open();
  expect(button("contentGpsOwner.add").disabled).toBe(true);
  expect(h.put).toHaveBeenCalledTimes(1);
  await click("contentGpsOwner.retrySave");
  expect(h.put.mock.calls[1][1].data).toEqual(first);
  expect(host.textContent).toContain("contentGpsOwner.saved");
});
it("requires explicit discard for a conflict and reloads the new owner's revision without another write", async () => {
  await open();
  await click("contentGpsOwner.remove");
  h.put.mockRejectedValueOnce(new ApiRequestError("CONFLICT", "Locations changed elsewhere", 409));
  await click("contentGpsOwner.save");
  await click("contentGpsOwner.discard");
  expect(host.textContent).toContain("contentGpsOwner.confirmDiscard");
  await click("common.cancel");
  expect(host.textContent).not.toContain("contentGpsOwner.confirmDiscard");
  await click("contentGpsOwner.discard");
  revision = { ...revision, version: 3, locations: [{ ...row, label: "Kyoto" }] };
  await click("contentGpsOwner.confirmDiscardAction");
  expect(firstInput().value).toBe("Kyoto");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(button("contentGpsOwner.retrySave")).toBeUndefined();
});
it("hides private rows after owner denial and recovers pending saves on Reload without discarding them", async () => {
  await open();
  h.put.mockRejectedValueOnce(new ApiRequestError("DENIED", "Owner required", 403));
  await click("contentGpsOwner.save");
  expect(host.querySelectorAll("input")).toHaveLength(0);
  await click("contentGpsOwner.reload");
  expect(host.textContent).not.toContain("contentGpsOwner.confirmDiscard");
  expect(firstInput().disabled).toBe(true);
  expect(button("contentGpsOwner.retrySave")).toBeDefined();
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("does not replay an acknowledged save after a failed latest-read", async () => {
  await open();
  h.get.mockRejectedValueOnce(Error("Refresh failed"));
  await click("contentGpsOwner.save");
  expect(host.textContent).toContain("Refresh failed");
  expect(button("contentGpsOwner.retrySave")).toBeUndefined();
  await click("contentGpsOwner.reload");
  expect(button("contentGpsOwner.save")).toBeDefined();
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("loads evidence only on request and revalidates adoption into an editable draft without writing", async () => {
  await open();
  await click("contentGpsSuggestions.title");
  expect(host.textContent).not.toContain(suggestion.evidence[0]!.quote);
  await click("contentGpsSuggestions.load");
  expect(host.textContent).toContain(suggestion.evidence[0]!.quote);
  await click("contentGpsSuggestions.add");
  expect(Array.from(host.querySelectorAll("input")).map((v) => v.value)).toEqual([
    "Singapore",
    "Tokyo",
  ]);
  expect(button("contentGpsSuggestions.already").disabled).toBe(true);
  expect(h.put).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects changed evidence and disables suggestions from a changed owner version", async () => {
  await open();
  await click("contentGpsSuggestions.title");
  await click("contentGpsSuggestions.load");
  h.get
    .mockResolvedValueOnce(revision)
    .mockResolvedValueOnce({ ...suggestions, locations: [{ ...suggestion, label: "Changed" }] });
  await click("contentGpsSuggestions.add");
  expect(host.textContent).toContain("review them again");
  expect(host.querySelectorAll("input")).toHaveLength(1);
  h.get.mockResolvedValueOnce({ ...suggestions, ownerVersion: 2 });
  await click("contentGpsSuggestions.load");
  expect(button("contentGpsSuggestions.add").disabled).toBe(true);
});
it("checks a lost analysis after reopening and only enables exact-ID retry on confirmed missing receipt", async () => {
  await open();
  await click("contentGpsSuggestions.title");
  h.post.mockRejectedValueOnce(Error("Reply lost"));
  await click("contentGpsSuggestions.analyze");
  expect(button("contentGpsSuggestions.analyze").disabled).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await open();
  await click("contentGpsSuggestions.title");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("contentGpsSuggestions.analyze").disabled).toBe(true);
  h.get
    .mockRejectedValueOnce(new ApiRequestError("MISSING", "Analysis not found", 404))
    .mockResolvedValueOnce(revision);
  await click("contentGpsSuggestions.checkAnalysis");
  expect(button("contentGpsSuggestions.retryAnalysis").disabled).toBe(false);
  h.get
    .mockRejectedValueOnce(new ApiRequestError("MISSING", "Analysis not found", 404))
    .mockResolvedValueOnce(revision)
    .mockResolvedValueOnce(revision)
    .mockResolvedValueOnce(receipt);
  await click("contentGpsSuggestions.retryAnalysis");
  expect(h.post.mock.calls[1][1].data).toEqual(h.post.mock.calls[0][1].data);
  expect(host.textContent).toContain("contentGpsSuggestions.analysis_succeeded");
});
it("never re-dispatches uncertain analysis or performs writes while backgrounded", async () => {
  await open();
  await click("contentGpsSuggestions.title");
  h.get.mockResolvedValueOnce(revision).mockResolvedValueOnce({ ...receipt, status: "uncertain" });
  await click("contentGpsSuggestions.analyze");
  expect(button("contentGpsSuggestions.analyze").disabled).toBe(true);
  expect(button("contentGpsSuggestions.checkAnalysis").disabled).toBe(false);
  h.active = false;
  await render();
  expect(button("contentGpsOwner.save").disabled).toBe(true);
  expect(button("contentGpsSuggestions.checkAnalysis").disabled).toBe(true);
  expect(h.post).toHaveBeenCalledTimes(1);
});
