import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CreatorCertificates } from "./creator-certificates";
const h = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  active: true,
  id: "a",
}));
vi.mock("./creator-certificates-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./creator-certificates-api")>()),
  listCreatorCertificates: h.list,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("./download-certificate", () => ({ downloadCertificate: h.download }));
vi.mock("./save-certificate", () => ({ saveCertificate: h.save }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: h.open }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({ SectionHeader: () => null }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div role="dialog">{children}</div> : null,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const row = {
  id: "1",
  certNo: "FD-GEN-2026-ABC123",
  title: "Producer",
  issuer: "FizzDragon",
  imageUrl: "https://example.com/c.png",
  issuedAt: "2026-10-01T00:00:00Z",
  validUntil: null,
};
const render = () => act(async () => root.render(<CreatorCertificates creatorId={h.id} />));
const click = (text: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.id = "a";
  h.list.mockResolvedValue([row]);
  h.open.mockResolvedValue(undefined);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
});
it("previews issued certificates and opens the original only on explicit action", async () => {
  await render();
  expect(host.textContent).toContain("Producer");
  expect(h.open).not.toHaveBeenCalled();
  await click("Producer");
  expect(host.querySelector("[role=dialog]")).not.toBeNull();
  await click("creatorCertificates.openOriginal");
  expect(h.open).toHaveBeenCalledWith(row.imageUrl);
  await click("creatorCertificates.close");
  expect(host.querySelector("[role=dialog]")).toBeNull();
});
it("retries registry failures without pretending the list is empty", async () => {
  h.list.mockRejectedValueOnce(new Error("Offline"));
  await render();
  expect(host.textContent).toContain("Offline");
  expect(host.textContent).not.toContain("creatorCertificates.empty");
  await click("common.retry");
  expect(host.textContent).toContain("Producer");
});
it("aborts and clears the old creator on navigation and focus loss", async () => {
  let finish!: (v: unknown) => void;
  h.list.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.list.mock.calls[0][1];
  h.id = "b";
  h.list.mockResolvedValue([]);
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish([row]));
  expect(host.textContent).not.toContain("Producer");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});
it("keeps metadata but hides unsafe original image actions", async () => {
  h.list.mockResolvedValue([{ ...row, imageUrl: "javascript:alert(1)" }]);
  await render();
  await click("Producer");
  expect(host.textContent).toContain("creatorCertificates.imageUnavailable");
  expect(host.textContent).not.toContain("creatorCertificates.openOriginal");
});

it("cancels an unfinished download when closing preview", async () => {
  let finish!: (v: unknown) => void;
  h.download.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("Producer");
  await click("creatorCertificates.save");
  const signal = h.download.mock.calls[0][2];
  await click("creatorCertificates.close");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ bytes: new Uint8Array(), filename: "cert.png", mimeType: "image/png" })
  );
  expect(h.save.mock.calls[0][1]()).toBe(false);
});
