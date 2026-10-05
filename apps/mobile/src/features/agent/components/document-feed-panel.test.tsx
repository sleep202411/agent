import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentFeedPanel } from "./document-feed-panel";
const h = vi.hoisted(() => ({
  threads: vi.fn(),
  versions: vi.fn(),
  active: true,
  displays: vi.fn(),
  write: vi.fn(),
  pending: null as null | { kind: string; body?: string; clientKey: string },
  storage: new Map<string, string>(),
  confirm: undefined as undefined | (() => void),
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, doc: string) => ({
    read: () => h.storage.get(`${ns}:${user}:${doc}`) ?? null,
    write: (v: string) => h.storage.set(`${ns}:${user}:${doc}`, v),
  }),
}));
vi.mock("../api/document-comments-api", () => ({
  writeDocumentComment: h.write,
  documentCommentPending: () => ({
    read: () => h.pending,
    clear: () => {
      h.pending = null;
    },
  }),
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
  Alert: {
    alert: (_title: string, _message: string, actions: { onPress?: () => void }[]) => {
      h.confirm = actions.at(-1)?.onPress;
    },
  },
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText(v: string): void;
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
const draw = (documentId = "doc", generation = 1, canComment = false) =>
  act(async () =>
    root.render(
      <DocumentFeedPanel
        documentId={documentId}
        generation={generation}
        userId="42"
        canComment={canComment}
        close={() => {}}
      />
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
  h.pending = null;
  h.storage.clear();
  h.confirm = undefined;
  h.write.mockImplementation(async (_cmd, _doc, _user, _gen, _signal, confirmed) => {
    confirmed?.();
  });
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

const fill = (key: string, text: string) =>
  act(async () => {
    const input = host.querySelector(`input[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
it("creates a thread, preserves a closed draft, and clears it only after confirmation", async () => {
  await draw("doc", 1, true);
  await click("documentFeed.newThread");
  await fill("documentFeed.body", "New discussion");
  h.active = false;
  await draw("doc", 1, true);
  h.active = true;
  await draw("doc", 1, true);
  expect(
    (host.querySelector('input[aria-label="documentFeed.body"]') as HTMLInputElement).value
  ).toBe("New discussion");
  await click("documentFeed.send");
  expect(h.write).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "create", body: "New discussion", documentId: "doc" }),
    "doc",
    "42",
    1,
    expect.any(AbortSignal),
    expect.any(Function)
  );
  expect(host.querySelector('input[aria-label="documentFeed.body"]')).toBeNull();
});
it("supports replies and confirmed resolution but exposes no writing controls to readers", async () => {
  await draw();
  expect(host.textContent).not.toContain("documentFeed.newThread");
  await draw("doc", 1, true);
  await click("documentFeed.reply");
  await fill("documentFeed.body", "Reply text");
  await click("documentFeed.send");
  expect(h.write.mock.calls[0][0]).toMatchObject({
    kind: "reply",
    threadId: "t",
    body: "Reply text",
  });
  await click("documentFeed.resolve");
  expect(h.write).toHaveBeenCalledTimes(1);
  await act(async () => h.confirm?.());
  expect(h.write.mock.calls[1][0]).toMatchObject({ kind: "resolve", threadId: "t" });
});
it("requires explicit review of uncertain writes and never resends when reopened", async () => {
  h.write.mockImplementation(async (command) => {
    h.pending = command;
    throw new Error("Response lost");
  });
  await draw("doc", 1, true);
  await click("documentFeed.newThread");
  await fill("documentFeed.body", "Keep me");
  await click("documentFeed.send");
  expect(host.textContent).toContain("documentFeed.uncertain");
  h.active = false;
  await draw("doc", 1, true);
  h.active = true;
  await draw("doc", 1, true);
  expect(h.write).toHaveBeenCalledTimes(1);
  await click("documentFeed.reviewed");
  expect(h.pending).not.toBeNull();
  await act(async () => h.confirm?.());
  expect(h.pending).toBeNull();
  expect(h.write).toHaveBeenCalledTimes(1);
});
it("rejects delayed resolution confirmation after permission loss", async () => {
  await draw("doc", 1, true);
  await click("documentFeed.resolve");
  await draw("doc", 1, false);
  await act(async () => h.confirm?.());
  expect(h.write).not.toHaveBeenCalled();
});
