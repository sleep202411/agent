import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ProjectActivity } from "./project-activity";
import { ProjectActivityPostError } from "./project-activity-api";
const h = vi.hoisted(() => ({
  generation: 1,
  invalid: false,
  active: true,
  access: vi.fn(),
  authors: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./project-activity-api", async (original) => ({
  ...(await original<typeof import("./project-activity-api")>()),
  fetchProjectActivityAccess: h.access,
  fetchProjectActivityPage: h.page,
  postProjectActivity: h.post,
}));
vi.mock("./project-activity-display", async (original) => ({
  ...(await original<typeof import("./project-activity-display")>()),
  fetchActivityAuthors: h.authors,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.com" }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./project-document-editor", () => ({ editorLabelKeys: [] }));
vi.mock("./production-document-editor-bridge", () => ({
  documentEditorHtml: () => "html",
  editorMessage: (value: string) => JSON.parse(value),
}));
vi.mock("./production-document-editor-frame", () => ({
  DocumentEditorFrame: ({ onMessage }: { onMessage: (value: string) => void }) => (
    <button
      onClick={() =>
        onMessage(
          JSON.stringify({
            type: "save",
            document: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "11111111-1111-4111-8111-111111111111" },
                  content: [{ type: "text", text: h.invalid ? " " : "New comment" }],
                },
              ],
            },
          })
        )
      }
    >
      save draft
    </button>
  ),
}));
vi.mock("./production-document-view", () => ({
  ProductionDocumentView: () => <span>rich reader</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Linking: { openURL: vi.fn() },
  TextInput: () => <input />,
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
let host: HTMLDivElement, root: Root;
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  crewId: "crew",
  kind: "comment",
  health: null,
  content: null,
  plainText: "Existing comment",
  progress: null,
  payload: {},
  createdByUserId: "user",
  createdAt: "2026-09-30T00:00:00.000Z",
};
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const render = () =>
  act(async () =>
    root.render(<ProjectActivity crewId="crew" userId="user" generation={1} onClose={h.close} />)
  );
const draft = async () => {
  await click("projectActivity.edit");
  await click("save draft");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.invalid = false;
  h.active = true;
  h.authors.mockResolvedValue({});
  h.access.mockResolvedValue({ view: true, manage: false });
  h.page.mockResolvedValue({ items: [row], nextCursor: null });
  h.post.mockResolvedValue({
    ...row,
    id: "22222222-2222-4222-8222-222222222222",
    plainText: "New comment",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("allows members to draft and post comments but hides manager controls", async () => {
  await render();
  expect(host.textContent).toContain("Existing comment");
  expect(button("projectActivity.update")).toBeUndefined();
  await draft();
  expect(h.post).not.toHaveBeenCalled();
  await click("projectActivity.post");
  expect(h.post.mock.calls[0]?.[3]).toMatchObject({ kind: "comment" });
  expect(button("projectActivity.post").disabled).toBe(true);
});
it("supports manager health updates and locks double submits", async () => {
  h.access.mockResolvedValue({ view: true, manage: true });
  let resolve!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await click("projectActivity.update");
  await click("projectActivity.at_risk");
  await draft();
  await click("projectActivity.post");
  await click("projectActivity.post");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0]?.[3]).toMatchObject({
    kind: "update",
    health: "at_risk",
    progress: null,
  });
  expect(button("crewTasks.back").disabled).toBe(true);
  await act(async () => resolve({ ...row, kind: "update", health: "at_risk" }));
});
it("keeps uncertain drafts locked across refresh until explicitly discarded", async () => {
  h.post.mockRejectedValue(new ProjectActivityPostError("Response lost", true));
  await render();
  await draft();
  await click("projectActivity.post");
  expect(host.textContent).toContain("Response lost");
  expect(button("projectActivity.post").disabled).toBe(true);
  await click("thread.refresh");
  expect(button("projectActivity.post").disabled).toBe(true);
  await click("projectActivity.checked");
  await click("projectActivity.confirmDiscard");
  expect(button("projectActivity.post").disabled).toBe(true);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("retains editable drafts when authorization rejects before writing", async () => {
  h.post.mockRejectedValue(new ProjectActivityPostError("Permission revoked", false));
  await render();
  await draft();
  await click("projectActivity.post");
  expect(host.textContent).toContain("New comment");
  expect(button("projectActivity.edit").disabled).toBe(false);
});
it("loads older pages and rejects a repeating cursor", async () => {
  h.page.mockResolvedValueOnce({ items: [row], nextCursor: id }).mockResolvedValueOnce({
    items: [{ ...row, id: "22222222-2222-4222-8222-222222222222" }],
    nextCursor: id,
  });
  await render();
  await click("projectActivity.more");
  expect(host.textContent).toContain("projectActivity.changed");
  expect(h.page.mock.calls[1]?.[2]).toBe(id);
});
it("clears private activity and refreshes permissions when returning from background", async () => {
  await render();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.access.mockResolvedValue({ view: false, manage: false });
  h.active = true;
  await render();
  expect(host.textContent).not.toContain("Existing comment");
  expect(host.textContent).toContain("projectActivity.denied");
});
it("ignores a late page after sign-out", async () => {
  let resolve!: (v: unknown) => void;
  h.page.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  h.generation++;
  await act(async () => resolve({ items: [row], nextCursor: null }));
  await render();
  expect(host.textContent).toBe("");
});

it("keeps invalid rich drafts editable before publishing", async () => {
  await render();
  await click("projectActivity.edit");
  h.invalid = true;
  await click("save draft");
  expect(host.textContent).toContain("projectActivity.invalidContent");
  expect(h.post).not.toHaveBeenCalled();
  h.invalid = false;
  await click("save draft");
  expect(host.textContent).toContain("New comment");
  expect(button("projectActivity.post").disabled).toBe(false);
});

it("keeps the rich editor mounted while backgrounded to preserve unsaved typing", async () => {
  await render();
  await click("projectActivity.edit");
  const before = button("save draft");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(button("save draft")).toBe(before);
  await click("save draft");
  expect(host.textContent).toContain("New comment");
});

it("shows resolved author names and audit details", async () => {
  h.authors.mockResolvedValue({ "123": "Sara" });
  h.page.mockResolvedValue({
    items: [
      {
        ...row,
        createdByUserId: "123",
        kind: "resource_added",
        payload: { resource: { title: "Script.pdf" } },
      },
    ],
    nextCursor: null,
  });
  await render();
  expect(host.textContent).toContain("Sara");
  expect(host.textContent).toContain("Script.pdf");
});
it("keeps the activity readable when author lookup fails", async () => {
  h.authors.mockRejectedValue(new Error("User lookup unavailable"));
  await render();
  expect(host.textContent).toContain("Existing comment");
  expect(host.textContent).toContain("user");
});
