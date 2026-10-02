import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { IpProfileEditor } from "./profile-editor";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  detail: vi.fn(),
  push: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
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
  uuid: { v4: () => "00000000-0000-4000-8000-000000000004" },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
const id = "11111111-1111-4111-8111-111111111111";
const ip = {
  id,
  version: 1,
  sourceLocale: "en-US",
  status: "draft",
  title: "Source",
  summary: "Summary",
  description: null,
  listingVisibility: "private",
  ageRating: "general",
  genreCodes: ["drama"],
};
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpProfileEditor ipId={id} userId="alice" generation={1} />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
const type = (label: string, value: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.records.clear();
  h.active = true;
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("taxonomy")
      ? { items: [{ type: "genre", code: "drama", label: "Drama" }] }
      : { ip }
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("edits source fields, validates an unchanged form and saves the expected version", async () => {
  h.put.mockResolvedValue({ ip: { ...ip, title: "Updated", version: 2 } });
  await mount();
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ipAuthor.save")?.disabled
  ).toBe(true);
  await type("ipAuthor.title", "Updated");
  await click("ipAuthor.save");
  expect(h.put.mock.calls[0]?.[1].data.expectedVersion).toBe(1);
  expect(host.textContent).toContain("ipAuthor.saved");
});
it("keeps uncertain saves frozen across remount and recovers without a second write", async () => {
  let stored = false;
  h.put.mockImplementation(async () => {
    stored = true;
    throw new Error("Response lost");
  });
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("taxonomy")
      ? { items: [{ type: "genre", code: "drama", label: "Drama" }] }
      : { ip: stored ? { ...ip, title: "Updated", version: 2 } : ip }
  );
  await mount();
  await type("ipAuthor.title", "Updated");
  await click("ipAuthor.save");
  expect(host.textContent).toContain("ipAuthor.pending");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.readOnly).toBe(
    true
  );
  await act(async () => root.render(null));
  await mount();
  await click("common.retry");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("ipAuthor.saved");
});
it("hides stale editable fields after a version conflict and requires a fresh snapshot", async () => {
  await mount();
  await type("ipAuthor.title", "Updated");
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("taxonomy")
      ? { items: [{ type: "genre", code: "drama", label: "Drama" }] }
      : { ip: { ...ip, title: "Other change", version: 3 } }
  );
  await click("ipAuthor.save");
  expect(h.put).not.toHaveBeenCalled();
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(host.textContent).toContain("updated elsewhere");
  await click("thread.refresh");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.value).toBe(
    "Updated"
  );
  expect(host.textContent).toContain("Other change");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.readOnly).toBe(
    true
  );
  await click("ipAuthor.keepDraft");
  expect(h.put).not.toHaveBeenCalled();
  h.put.mockResolvedValue({ ip: { ...ip, title: "Updated", version: 4 } });
  await click("ipAuthor.save");
  expect(h.put.mock.calls[0]?.[1].data.expectedVersion).toBe(3);
  expect(host.textContent).toContain("ipAuthor.saved");
});
it.each([400, 422])("preserves editable rejected drafts across refresh for %s", async (status) => {
  h.put.mockRejectedValue(new ApiRequestError("INVALID", "Please revise", status));
  await mount();
  await type("ipAuthor.title", "My draft");
  await click("ipAuthor.save");
  const input = () => host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]');
  expect(input()?.value).toBe("My draft");
  expect(input()?.readOnly).toBe(false);
  await click("thread.refresh");
  expect(input()?.value).toBe("My draft");
  expect(h.put).toHaveBeenCalledTimes(1);
  await type("ipAuthor.title", "Revised draft");
  h.put.mockResolvedValue({ ip: { ...ip, title: "Revised draft", version: 2 } });
  await click("ipAuthor.save");
  expect(host.textContent).toContain("ipAuthor.saved");
  await click("thread.refresh");
  expect(input()?.value).toBe("Source");
});
it.each([401, 403, 404])(
  "hides inaccessible fields for %s and only restores after fresh access",
  async (status) => {
    h.put.mockRejectedValue(new ApiRequestError("DENIED", "Access denied", status));
    await mount();
    await type("ipAuthor.title", "Private draft");
    await click("ipAuthor.save");
    expect(host.querySelectorAll("input")).toHaveLength(0);
    h.get.mockRejectedValue(new ApiRequestError("DENIED", "Access denied", status));
    await click("thread.refresh");
    expect(host.querySelectorAll("input")).toHaveLength(0);
    h.get.mockImplementation(async (path: string) =>
      path.endsWith("taxonomy") ? { items: [] } : { ip }
    );
    await click("thread.refresh");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.value).toBe(
      "Private draft"
    );
    expect(h.put).toHaveBeenCalledTimes(1);
  }
);
it("hides private source content when the screen becomes inactive", async () => {
  await mount();
  h.active = false;
  await mount();
  expect(host.querySelectorAll("input")).toHaveLength(0);
});
