import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectDocument } from "./project-document";
const h = vi.hoisted(() => ({ generation: 1, fetch: vi.fn(), close: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./project-document-api", () => ({ fetchProjectDocument: h.fetch }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("./production-document-view", () => ({
  ProductionDocumentView: ({ html, onError }: { html: string; onError: () => void }) => (
    <>
      <pre>{html}</pre>
      <button onClick={onError}>renderer failed</button>
    </>
  ),
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
        content: [{ type: "text", text: "Private overview" }],
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
