import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectDocumentEditor } from "./project-document-editor";
const h = vi.hoisted(() => ({
  generation: 1,
  prevent: false,
  routeRemove: undefined as undefined | ((event: { data: { action: { type: string } } }) => void),
  dispatch: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  saved: vi.fn(),
  receive: undefined as undefined | ((raw: unknown) => void),
}));
vi.mock("expo-router", () => ({ useNavigation: () => ({ dispatch: h.dispatch }) }));
vi.mock("expo-router/build/react-navigation/core/usePreventRemove", () => ({
  usePreventRemove: (prevent: boolean, callback: typeof h.routeRemove) => {
    h.prevent = prevent;
    h.routeRemove = callback;
  },
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./project-document-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project-document-api")>()),
  createProjectDocumentSaver: () => h.save,
}));
vi.mock("./production-document-editor-frame", () => ({
  DocumentEditorFrame: ({ onMessage }: { onMessage: (raw: unknown) => void }) => {
    h.receive = onMessage;
    return <div>rich editor</div>;
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const documentValue = {
  type: "doc" as const,
  content: [{ type: "paragraph", attrs: { id: "11111111-1111-4111-8111-111111111111" } }],
};
const page = { crewId: "crew", version: 7, document: documentValue };
let host: HTMLDivElement, root: Root;
const send = (value: unknown) => act(async () => h.receive!(JSON.stringify(value)));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(async () => {
  vi.clearAllMocks();
  h.generation = 1;
  h.save.mockResolvedValue({ ...page, version: 8 });
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ProjectDocumentEditor
        crewId="crew"
        userId="actor"
        generation={1}
        page={page}
        onClose={h.close}
        onSaved={h.saved}
      />
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("saves only canonical editor content and returns on success", async () => {
  await send({ type: "save", document: documentValue });
  expect(h.save).toHaveBeenCalledWith(documentValue);
  expect(h.saved).toHaveBeenCalledOnce();
});
it("asks before discarding an edited document", async () => {
  await send({ type: "dirty" });
  await click("crewTasks.back");
  expect(h.close).not.toHaveBeenCalled();
  expect(host.textContent).toContain("documentEditor.discardQuestion");
  await click("documentEditor.discard");
  expect(h.close).toHaveBeenCalledOnce();
});
it("rejects malformed and stale-session messages", async () => {
  await send({ type: "save", document: { type: "doc", content: [] } });
  h.generation = 2;
  await send({ type: "save", document: documentValue });
  expect(h.save).not.toHaveBeenCalled();
});
it("locks failed writes and keeps editor content visible for review", async () => {
  h.save.mockRejectedValueOnce(new Error("Version conflict"));
  await send({ type: "save", document: documentValue });
  expect(host.textContent).toContain("Version conflict");
  expect(host.textContent).toContain("rich editor");
  await send({ type: "save", document: documentValue });
  expect(h.save).toHaveBeenCalledOnce();
  expect(h.saved).not.toHaveBeenCalled();
});
it("ignores duplicated save events while pending and late results after account change", async () => {
  let resolve!: (v: unknown) => void;
  h.save.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await send({ type: "save", document: documentValue });
  await send({ type: "save", document: documentValue });
  expect(h.save).toHaveBeenCalledOnce();
  h.generation = 2;
  await act(async () => resolve(page));
  expect(h.saved).not.toHaveBeenCalled();
});

it("asks before route removal and dispatches the original action only after discard", async () => {
  expect(h.prevent).toBe(false);
  await send({ type: "dirty" });
  expect(h.prevent).toBe(true);
  const action = { type: "GO_BACK" };
  await act(async () => h.routeRemove!({ data: { action } }));
  expect(h.dispatch).not.toHaveBeenCalled();
  await click("documentEditor.keepEditing");
  expect(h.dispatch).not.toHaveBeenCalled();
  await act(async () => h.routeRemove!({ data: { action } }));
  await click("documentEditor.discard");
  expect(h.dispatch).toHaveBeenCalledWith(action);
  expect(h.close).not.toHaveBeenCalled();
});
it("blocks route removal and an already-visible discard while saving", async () => {
  await send({ type: "dirty" });
  await click("crewTasks.back");
  let finish!: (value: unknown) => void;
  h.save.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await send({ type: "save", document: documentValue });
  await click("documentEditor.discard");
  await act(async () => h.routeRemove!({ data: { action: { type: "GO_BACK" } } }));
  expect(h.close).not.toHaveBeenCalled();
  expect(h.dispatch).not.toHaveBeenCalled();
  await act(async () => finish(page));
  expect(h.saved).toHaveBeenCalledOnce();
});
