// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpKnowledgeAssistant } from "./ip-knowledge-assistant";
const mocks = vi.hoisted(() => ({
  locale: "zh-CN",
  ipId: "film",
  post: vi.fn(),
  open: vi.fn(),
  user: { id: "user" } as { id: string } | null,
}));
vi.mock("@/src/lib/api", () => ({ api: { post: mocks.post } }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: mocks.user }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: mocks.open }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => mocks.locale,
  useTranslations: () => (key: string) => key,
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.post.mockReset();
  mocks.open.mockReset();
  mocks.user = { id: "user" };
  mocks.locale = "zh-CN";
  mocks.ipId = "film";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(<IpKnowledgeAssistant ipId={mocks.ipId} ipTitle="Current film" />)
  );
}
async function open() {
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
}
async function ask() {
  const input = document.body.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Who created this?"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document.body
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
it("opens on demand, submits with film context and aborts on close", async () => {
  mocks.post.mockReturnValue(new Promise(() => {}));
  await render();
  expect(document.body.querySelector("form")).toBeNull();
  await open();
  expect(document.body.textContent).toContain("Current film");
  await ask();
  expect(mocks.post).toHaveBeenCalledWith(
    "/aurora/ip-commerce/ips/film/knowledge/ask",
    expect.objectContaining({ data: { question: "Who created this?", locale: "zh-CN" } })
  );
  await act(async () =>
    document.body
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(mocks.post).toHaveBeenCalledTimes(1);
  const signal = mocks.post.mock.calls[0][1].signal as AbortSignal;
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('button[aria-label="close"]')!.click()
  );
  expect(signal.aborted).toBe(true);
  expect(document.body.querySelector("form")).toBeNull();
});
it("requires login before sending a question", async () => {
  mocks.user = null;
  await render();
  await open();
  await ask();
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.post).not.toHaveBeenCalled();
});

it.each(["locale", "account", "film"])("discards an old answer when %s changes", async (change) => {
  let resolveOld!: (value: unknown) => void;
  mocks.post.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    })
  );
  await render();
  await open();
  await ask();
  const oldSignal = mocks.post.mock.calls[0]![1].signal as AbortSignal;
  if (change === "locale") mocks.locale = "en-US";
  if (change === "account") mocks.user = { id: "other" };
  if (change === "film") mocks.ipId = "other-film";
  await render();
  expect(oldSignal.aborted).toBe(true);
  expect(document.body.querySelector("input")!.value).toBe("");
  mocks.post.mockResolvedValueOnce({
    answer: "Current answer",
    citedDocumentIds: [],
    unanswered: false,
  });
  await ask();
  expect(mocks.post).toHaveBeenLastCalledWith(
    `/aurora/ip-commerce/ips/${mocks.ipId}/knowledge/ask`,
    expect.objectContaining({ data: { question: "Who created this?", locale: mocks.locale } })
  );
  await act(async () =>
    resolveOld({ answer: "Obsolete answer", citedDocumentIds: ["old"], unanswered: false })
  );
  expect(document.body.textContent).toContain("Current answer");
  expect(document.body.textContent).not.toContain("Obsolete answer");
});

it("shows the backend failure instead of hiding it behind the generic message", async () => {
  mocks.post.mockRejectedValue(new Error("Knowledge assistance is not configured."));
  await render();
  await open();
  await ask();
  expect(document.body.textContent).toContain("Knowledge assistance is not configured.");
});
