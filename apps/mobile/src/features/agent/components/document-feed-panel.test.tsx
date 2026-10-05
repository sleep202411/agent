import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentFeedPanel } from "./document-feed-panel";
const h = vi.hoisted(() => ({
  threads: vi.fn(),
  versions: vi.fn(),
  active: true,
  displays: vi.fn(),
}));
vi.mock("@/features/services/user-displays", () => ({ useUserDisplays: h.displays }));
vi.mock("../api/document-feeds-api", () => ({
  listDocumentThreads: h.threads,
  listDocumentVersions: h.versions,
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const row = {
  id: "t",
  title: null,
  status: "open",
  blockId: "node-1",
  createdById: "42",
  comments: [
    {
      id: "c",
      createdById: "42",
      body: "Review <b>this</b>\n细节",
      createdAt: "2026-10-05T00:00:00Z",
    },
  ],
};
const draw = (documentId = "doc", generation = 1) =>
  act(async () =>
    root.render(
      <DocumentFeedPanel documentId={documentId} generation={generation} close={() => {}} />
    )
  );
const click = (key: string) =>
  act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === key)!
      .click();
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.threads.mockResolvedValue([row]);
  h.versions.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("shows literal comments and separate history with retryable errors", async () => {
  await draw();
  expect(host.textContent).toContain(row.comments[0].body);
  expect(host.querySelector("b")).toBeNull();
  h.versions.mockRejectedValueOnce(new Error("History unavailable"));
  await click("documentFeed.history");
  expect(host.textContent).not.toContain(row.comments[0].body);
  expect(host.textContent).toContain("History unavailable");
  expect(host.textContent).not.toContain("documentFeed.noHistory");
  await click("common.retry");
  expect(host.textContent).toContain("documentFeed.noHistory");
});
it("retains rows on transient failures, clears them on denied access, and recovers", async () => {
  await draw();
  h.threads.mockRejectedValueOnce(new Error("Offline"));
  await click("documentFeed.refresh");
  expect(host.textContent).toContain(row.comments[0].body);
  h.threads.mockRejectedValueOnce(Object.assign(new Error("Revoked"), { status: 403 }));
  await click("common.retry");
  expect(host.textContent).not.toContain(row.comments[0].body);
  expect(host.textContent).toContain("Revoked");
  await click("common.retry");
  expect(host.textContent).toContain(row.comments[0].body);
});
it("aborts obsolete reads across document, account, and background changes", async () => {
  let resolve!: (rows: unknown[]) => void;
  h.threads.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await draw();
  const signal = h.threads.mock.calls[0][2] as AbortSignal;
  await draw("next", 2);
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve([{ ...row, comments: [{ ...row.comments[0], body: "OLD PRIVATE" }] }])
  );
  expect(host.textContent).not.toContain("OLD PRIVATE");
  h.active = false;
  await draw("next", 2);
  expect(host.textContent).toBe("");
  h.active = true;
  await draw("next", 2);
  expect(h.threads).toHaveBeenCalledTimes(3);
});
it("polls while visible without cancelling a slow in-flight read", async () => {
  vi.useFakeTimers();
  let resolve!: (rows: unknown[]) => void;
  h.threads.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await draw();
  await act(async () => vi.advanceTimersByTime(30000));
  expect(h.threads).toHaveBeenCalledTimes(1);
  await act(async () => resolve([row]));
  await act(async () => vi.advanceTimersByTime(15000));
  expect(h.threads).toHaveBeenCalledTimes(2);
  h.active = false;
  await draw();
  await act(async () => vi.advanceTimersByTime(30000));
  expect(h.threads).toHaveBeenCalledTimes(2);
});

it("shows authors and resolution attribution without leaking raw IDs when lookup fails", async () => {
  h.displays.mockReturnValue(
    new Map([
      ["42", { nickname: "Pax" }],
      ["77", { nickname: "$& Resolver" }],
    ])
  );
  h.threads.mockResolvedValue([{ ...row, status: "resolved", resolvedById: "77" }]);
  await draw();
  expect(host.textContent).toContain("Pax");
  expect(host.textContent).toContain("documentFeed.resolvedBy $& Resolver");
  expect(h.displays).toHaveBeenLastCalledWith("1:doc", expect.arrayContaining(["42", "77"]));
  h.displays.mockReturnValue(undefined);
  await draw();
  expect(host.textContent).not.toContain("Pax");
  expect(host.textContent).toContain("documentFeed.unknownAuthor");
  expect(host.textContent).toContain(row.comments[0].body);
});
it("scopes author enrichment to the current feed and clears it after revocation", async () => {
  await draw();
  await draw("second", 2);
  expect(h.displays).toHaveBeenLastCalledWith("2:second", expect.any(Array));
  h.threads.mockRejectedValueOnce(Object.assign(new Error("Revoked"), { status: 403 }));
  await click("documentFeed.refresh");
  expect(h.displays).toHaveBeenLastCalledWith(undefined, []);
});
