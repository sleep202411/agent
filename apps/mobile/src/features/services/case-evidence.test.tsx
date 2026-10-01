import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CaseEvidence } from "./case-evidence";
const h = vi.hoisted(() => ({
  active: true,
  generation: 1,
  get: vi.fn(),
  put: vi.fn(),
  pick: vi.fn(),
  fetch: vi.fn(),
  open: vi.fn(),
  post: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
  ApiRequestError: class extends Error {},
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
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
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
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = {
  id: id(4),
  name: "proof.pdf",
  contentType: "application/pdf",
  sizeBytes: 3,
  ready: true,
  shared: false,
  createdAt: "2026-10-01T00:00:00Z",
};
let root: Root, host: HTMLDivElement;
function Fixture() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <CaseEvidence
        caseId={id(1)}
        generation={1}
        disabled={false}
        selected={selected}
        onSelect={setSelected}
        onBusy={() => {}}
      />
      <span>selected:{selected.join(",")}</span>
    </>
  );
}
const mount = () => act(async () => root.render(<Fixture />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [], nextBeforeId: null });
  h.fetch.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", h.fetch);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("retries lost upload confirmation without uploading bytes twice", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: "proof.pdf", mimeType: "application/pdf", size: 3, file: new Blob(["abc"]) }],
  });
  h.post
    .mockResolvedValueOnce({
      url: "https://storage.example/upload",
      method: "PUT",
      headers: {},
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    })
    .mockRejectedValueOnce(Error("Confirmation lost"))
    .mockResolvedValue({ id: id(4) });
  await mount();
  await click("thread.uploadFile");
  expect(host.textContent).toContain("Confirmation lost");
  h.get.mockResolvedValue({ items: [row], nextBeforeId: null });
  await click("caseEvidence.retry");
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("caseEvidence.private");
  await click("☐ caseEvidence.select");
  expect(host.textContent).toContain(`selected:${id(4)}`);
  expect(h.post).toHaveBeenCalledTimes(3);
});
it("requests a fresh private read URL and clears listing after permission failure", async () => {
  h.get.mockResolvedValueOnce({ items: [row], nextBeforeId: null }).mockResolvedValueOnce({
    url: "https://storage.example/read",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await mount();
  await click("caseEvidence.open");
  expect(h.open).toHaveBeenCalledWith("https://storage.example/read");
  h.get.mockRejectedValue(Error("Access denied"));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("proof.pdf");
  expect(host.textContent).toContain("Access denied");
});
