import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectDocument } from "./project-document";
const h = vi.hoisted(() => ({
  generation: 1,
  fetch: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  link: undefined as undefined | ((index: number) => void),
}));
vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.fizzspace.cn" }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./project-document-api", () => ({ fetchProjectDocument: h.fetch }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("./production-document-view", () => ({
  ProductionDocumentView: ({
    html,
    onError,
    onLink,
  }: {
    html: string;
    onError: () => void;
    onLink: (index: number) => void;
  }) => {
    h.link = onLink;
    return (
      <>
        <pre>{html}</pre>
        <button onClick={onError}>renderer failed</button>
      </>
    );
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const page = {
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "11111111-1111-4111-8111-111111111111" },
        content: [
          {
            type: "text",
            text: "Private overview",
            marks: [{ type: "link", attrs: { href: "/en-US/crews" } }],
          },
        ],
      },
    ],
  },
};
const render = () =>
  act(async () =>
    root.render(<ProjectDocument crewId="crew" userId="actor" generation={1} onClose={h.close} />)
  );
const click = async (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.open.mockResolvedValue(undefined);
  h.fetch.mockResolvedValue(page);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("renders the document and keeps return navigation", async () => {
  await render();
  expect(host.textContent).toContain("Private overview");
  await click("crewTasks.back");
  expect(h.close).toHaveBeenCalledOnce();
});
it("removes previous private content during refresh and preserves backend errors", async () => {
  await render();
  h.fetch.mockRejectedValueOnce(new Error("Access revoked"));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("Private overview");
  expect(host.textContent).toContain("Access revoked");
});
it("ignores a late response after account change", async () => {
  let resolve!: (value: unknown) => void;
  h.fetch.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  h.generation = 2;
  await act(async () => resolve(page));
  expect(host.textContent).not.toContain("Private overview");
  await render();
  expect(host.textContent).toBe("");
});
it("aborts reads on unmount", async () => {
  h.fetch.mockReturnValueOnce(new Promise(() => {}));
  await render();
  const signal = h.fetch.mock.calls[0][3] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("shows render failures and allows retry", async () => {
  await render();
  await click("renderer failed");
  expect(host.textContent).toContain("projectDocument.loadError");
  expect(host.textContent).not.toContain("Private overview");
  await click("thread.refresh");
  expect(host.textContent).toContain("Private overview");
});

it("opens canonical links on the current regional site only after a tap", async () => {
  await render();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => h.link!(0));
  expect(h.open).toHaveBeenCalledWith("https://fizzdragon.fizzspace.cn/en-US/crews");
});
it("ignores invalid indexes and stale account link events", async () => {
  await render();
  await act(async () => h.link!(999));
  h.generation = 2;
  await act(async () => h.link!(0));
  expect(h.open).not.toHaveBeenCalled();
});
it("ignores links from a removed document during refresh", async () => {
  await render();
  const old = h.link!;
  h.fetch.mockReturnValueOnce(new Promise(() => {}));
  await click("thread.refresh");
  await act(async () => old(0));
  expect(h.open).not.toHaveBeenCalled();
});
it("localizes device link errors without hiding the document", async () => {
  await render();
  h.open.mockRejectedValueOnce(new Error("OS error"));
  await act(async () => h.link!(0));
  expect(host.textContent).toContain("projectDocument.linkOpenError");
  expect(host.textContent).toContain("Private overview");
});
