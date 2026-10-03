import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpCreateForm } from "./create-form";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  analyze: vi.fn(),
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
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
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
vi.mock("./spark-api", () => ({ analyzeIpDocument: h.analyze }));
vi.mock("@repo/shared", () => ({ REGIONS: [{ code: "SG" }], regionLabel: (code: string) => code }));
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpCreateForm userId="alice" generation={1} onCreated={h.push} />));
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
  h.focused = true;
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  h.get.mockResolvedValue({ items: [{ type: "genre", code: "drama", label: "Drama" }] });
  h.post.mockResolvedValue({
    ip: { id: "11111111-1111-4111-8111-111111111111", createdById: "alice" },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires title and genre, creates the selected channel, and opens the returned IP", async () => {
  await mount();
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ipCreate.submit")?.disabled
  ).toBe(true);
  await type("ipAuthor.title", "My IP");
  await click("☐ Drama");
  await click("○ ipCreate.community");
  await click("ipCreate.submit");
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    title: "My IP",
    genreCodes: ["drama"],
    channelType: "community",
  });
  expect(h.push).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
});
it("freezes uncertain creation, retains it on remount and retries the identical key and body", async () => {
  h.post.mockRejectedValueOnce(Error("Lost response"));
  await mount();
  await type("ipAuthor.title", "My IP");
  await click("☐ Drama");
  await click("ipCreate.submit");
  expect(host.textContent).toContain("ipCreate.pending");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.readOnly).toBe(
    true
  );
  await act(async () => root.render(null));
  await mount();
  await click("common.retry");
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
  expect(h.push).toHaveBeenCalledTimes(1);
});
it("fills only empty fields using the latest edits while analysis runs", async () => {
  let resolve!: (value: { name: string; description: string; fileName: string }) => void;
  h.analyze.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount();
  await click("ipCreate.analyze");
  await type("ipAuthor.title", "Typed while waiting");
  await act(async () =>
    resolve({ name: "Suggestion", description: "Suggested summary", fileName: "brief.pdf" })
  );
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.value).toBe(
    "Typed while waiting"
  );
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.summary"]')?.value).toBe(
    "Suggested summary"
  );
});
it("recovers taxonomy errors without clearing typed fields and hides content in background", async () => {
  h.get.mockRejectedValueOnce(Error("Genres unavailable"));
  await mount();
  await type("ipAuthor.title", "Retain me");
  expect(host.textContent).toContain("Genres unavailable");
  await click("common.retry");
  expect(host.textContent).toContain("Drama");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.value).toBe(
    "Retain me"
  );
  h.active = false;
  await mount();
  expect(host.querySelectorAll("input")).toHaveLength(0);
});
it("clears only unedited document suggestions and retains channel and region choices", async () => {
  h.analyze.mockResolvedValue({
    name: "Suggested title",
    description: "Suggested summary",
    fileName: "brief.txt",
  });
  await mount();
  await click("○ ipCreate.community");
  await click("ipCreate.region: ipCreate.unspecified");
  await click("○ SG");
  await click("ipCreate.analyze");
  await type("ipAuthor.title", "Manually edited");
  await click("ipCreate.clearAnalysis");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.value).toBe(
    "Manually edited"
  );
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.summary"]')?.value).toBe(
    ""
  );
  expect(host.textContent).toContain("● ipCreate.community");
  expect(host.textContent).toContain("ipCreate.region: SG");
});
it("clears a rejected creation so its fields can be corrected", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  h.post.mockRejectedValueOnce(new ApiRequestError("INVALID", "Genre no longer available", 400));
  await mount();
  await type("ipAuthor.title", "My IP");
  await click("☐ Drama");
  await click("ipCreate.submit");
  expect(host.textContent).toContain("Genre no longer available");
  expect(host.textContent).not.toContain("ipCreate.pending");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.readOnly).toBe(
    false
  );
});

it("preserves unsaved fields and document analysis through backgrounding", async () => {
  let finish!: (value: unknown) => void;
  h.analyze.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await type("ipAuthor.title", "My title");
  await click("☐ Drama");
  await click("ipCreate.analyze");
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  await act(async () =>
    finish({ name: "Suggestion", description: "Suggested summary", fileName: "brief.txt" })
  );
  h.active = true;
  await mount();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.title"]')?.value).toBe(
    "My title"
  );
  expect(host.querySelector<HTMLInputElement>('input[aria-label="ipAuthor.summary"]')?.value).toBe(
    "Suggested summary"
  );
  expect(h.post).not.toHaveBeenCalled();
  await click("ipCreate.submit");
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    title: "My title",
    summary: "Suggested summary",
    genreCodes: ["drama"],
  });
});
for (const exit of ["route", "account"] as const) {
  it(`aborts document analysis on ${exit} exit`, async () => {
    let finish!: (value: unknown) => void;
    h.analyze.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await click("ipCreate.analyze");
    const signal = h.analyze.mock.calls[0][1] as AbortSignal;
    if (exit === "route") h.focused = false;
    else h.generation = 2;
    await mount();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish({ name: "Suggestion", description: "Summary", fileName: "brief.txt" })
    );
    expect(host.textContent).toBe("");
    expect(h.post).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
  });
}
