import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AudienceKnowledgeEditor } from "./audience-knowledge-editor";
const state = vi.hoisted(() => ({ locale: "en", get: vi.fn(), put: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ api: state }));
vi.mock("@/src/i18n/i18n", () => {
  const en = (key: string) => key;
  const zh = (key: string) => `zh:${key}`;
  return { useTranslations: () => (state.locale === "en" ? en : zh) };
});
let root: Root, host: HTMLDivElement;
const document = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Official synopsis",
  content: "Published film background.",
  isPublished: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  host = globalThis.document.createElement("div");
  root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.get.mockResolvedValue({
    documents: [{ ...document, updatedAt: "2026-10-11" }],
    version: 5,
  });
  state.put.mockImplementation((_url, options) =>
    Promise.resolve({ documents: options.data.documents, version: 6 })
  );
});
afterEach(() => act(() => root.unmount()));
async function mount() {
  await act(async () => root.render(<AudienceKnowledgeEditor ipId="film" />));
}
async function save() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
it("publishes only explicitly selected documents and sends the loaded version without server-only fields", async () => {
  await mount();
  expect((host.querySelector('[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
  await act(async () => (host.querySelector('[type="checkbox"]') as HTMLInputElement).click());
  await save();
  expect(state.put).toHaveBeenCalledWith(
    "/aurora/ip-commerce/me/ips/film/knowledge-documents",
    expect.objectContaining({
      data: { expectedVersion: 5, documents: [{ ...document, isPublished: true }] },
    })
  );
  expect(host.textContent).toContain("saved");
});
it("retains edits on version conflict and blocks writes until explicit reload", async () => {
  await mount();
  state.put.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
  await save();
  await save();
  expect(state.put).toHaveBeenCalledTimes(1);
  expect(host.querySelector("input")!.value).toBe(document.title);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("conflict");
  state.get.mockResolvedValue({ documents: [document], version: 8 });
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "reload")!.click()
  );
  await save();
  expect(state.put.mock.calls[1][1].data.expectedVersion).toBe(8);
});
it("does not allow an empty replacement write after a load failure", async () => {
  state.get.mockRejectedValue(new Error("Forbidden"));
  await mount();
  await save();
  expect(state.put).not.toHaveBeenCalled();
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
});
it("starts new reference documents as private drafts", async () => {
  await mount();
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "add")!.click()
  );
  expect(
    [...host.querySelectorAll<HTMLInputElement>('[type="checkbox"]')].map((input) => input.checked)
  ).toEqual([false, false]);
  expect(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
});

it("preserves unsaved publication changes when the language changes", async () => {
  await mount();
  await act(async () => host.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
  state.locale = "zh";
  await mount();
  expect(host.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
  expect(state.get).toHaveBeenCalledTimes(1);
});
