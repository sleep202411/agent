import { ServiceEditorDrafts } from "./service-editor-drafts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ServiceDetailsEditor } from "./service-details-editor";
import type { CreatorServiceDetail } from "@/data/types";
const h = vi.hoisted(() => ({
  change: vi.fn(),
  refresh: vi.fn(),
  user: "owner",
  generation: 1,
  authenticated: true,
}));
vi.mock("./service-edit-api", async (original) => ({
  ...(await original<typeof import("./service-edit-api")>()),
  saveServiceDetails: h.change,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.user },
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (text: string) => void;
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
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const service = {
  id: "s",
  creatorId: "owner",
  status: "listed",
  version: 3,
  title: "Film",
  summary: "Editing",
  category: "editing_post",
  tags: ["film"],
} as CreatorServiceDetail;
const render = (status = "listed") =>
  act(async () =>
    root.render(<ServiceDetailsEditor service={{ ...service, status }} refresh={h.refresh} />)
  );
const click = (key: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === key)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.user = "owner";
  h.generation = 1;
  h.authenticated = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("gates ownership and serializes saves with the loaded version", async () => {
  h.user = "visitor";
  await render();
  expect(host.textContent).toBe("");
  h.user = "owner";
  await render();
  let finish!: () => void;
  h.change.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => click("serviceEdit.title"));
  await act(async () => {
    click("profileEdit.save");
    click("profileEdit.save");
  });
  expect(h.change).toHaveBeenCalledExactlyOnceWith("s", {
    title: "Film",
    summary: "Editing",
    category: "editing_post",
    tags: ["film"],
    expectedVersion: 3,
  });
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("discards stale-account completions and hides archived editing", async () => {
  let finish!: () => void;
  h.change.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => click("serviceEdit.title"));
  await act(async () => click("profileEdit.save"));
  h.generation++;
  await render();
  await act(async () => finish());
  expect(h.refresh).not.toHaveBeenCalled();
  await render("archived");
  expect(host.textContent).toBe("");
});
it("retains a failed draft and offers explicit discard/reload", async () => {
  h.change.mockRejectedValue(new Error("Stale version"));
  await render();
  await act(async () => click("serviceEdit.title"));
  await act(async () => click("profileEdit.save"));
  expect(host.textContent).toContain("Stale version");
  expect(host.querySelector("input")?.value).toBe("Film");
  expect(h.refresh).not.toHaveBeenCalled();
  await act(async () => click("serviceEdit.reload"));
  expect(h.refresh).toHaveBeenCalledOnce();
});

const renderStored = (visible: boolean, version = 3, owner = "owner") =>
  act(async () =>
    root.render(
      <ServiceEditorDrafts key={owner}>
        {visible && <ServiceDetailsEditor service={{ ...service, version }} refresh={h.refresh} />}
      </ServiceEditorDrafts>
    )
  );
const editTitle = async (value: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
it("preserves a sibling-panel reload draft and its original concurrency token", async () => {
  document.body.append(host);
  await renderStored(true);
  await act(async () => click("serviceEdit.title"));
  await editTitle("Unsaved film title");
  await renderStored(false);
  await renderStored(true, 4);
  expect(host.querySelector("input")?.value).toBe("Unsaved film title");
  h.change.mockResolvedValue(undefined);
  await act(async () => click("profileEdit.save"));
  expect(h.change).toHaveBeenCalledWith(
    "s",
    expect.objectContaining({ title: "Unsaved film title", expectedVersion: 3 })
  );
  await renderStored(false);
  await renderStored(true, 5);
  expect(host.querySelector("input")).toBeNull();
  await act(async () => click("serviceEdit.title"));
  expect(host.querySelector("input")?.value).toBe("Film");
  host.remove();
});
it("explicit discard reloads fresh fields and version without reusing the discarded draft", async () => {
  document.body.append(host);
  h.change.mockRejectedValue(new Error("Stale version"));
  await renderStored(true);
  await act(async () => click("serviceEdit.title"));
  await editTitle("Discard this edit");
  await act(async () => click("profileEdit.save"));
  await act(async () => click("serviceEdit.reload"));
  await renderStored(false);
  await renderStored(true, 4);
  await act(async () => click("serviceEdit.title"));
  expect(host.querySelector("input")?.value).toBe("Film");
  h.change.mockResolvedValue(undefined);
  await act(async () => click("profileEdit.save"));
  expect(h.change).toHaveBeenLastCalledWith("s", expect.objectContaining({ expectedVersion: 4 }));
  host.remove();
});
it("does not restore service drafts into a new account scope", async () => {
  document.body.append(host);
  await renderStored(true);
  await act(async () => click("serviceEdit.title"));
  await editTitle("Private draft");
  await renderStored(true, 3, "different-session");
  expect(host.querySelector("input")).toBeNull();
  await act(async () => click("serviceEdit.title"));
  expect(host.querySelector("input")?.value).toBe("Film");
  host.remove();
});
