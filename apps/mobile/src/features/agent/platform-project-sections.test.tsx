import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PlatformProjectSections } from "./platform-project-sections";
import { SectionWriteError } from "./api/platform-sections-api";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  list: vi.fn(),
  write: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, getLocale: () => "en-US" }));
vi.mock("./api/platform-sections-api", async (original) => ({
  ...(await original<typeof import("./api/platform-sections-api")>()),
  fetchPlatformSections: h.list,
  changePlatformSection: h.write,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Linking: { openURL: h.open },
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));

const projectId = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222";
const rows = [3, 4].map((n) => ({
  id: `${n}1111111-1111-4111-8111-111111111111`,
  projectId,
  title: `Chapter ${n}`,
  rank: n,
  version: 1,
  canvasDocumentId: `${n}2222222-2222-4222-8222-222222222222`,
}));
const data = { projectId, workspaceId, canEdit: true, projectVersion: 7, sections: rows };
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () =>
  act(async () => {
    root.render(
      <PlatformProjectSections
        projectId={projectId}
        workspaceId={workspaceId}
        name="Film"
        generation={1}
        onClose={h.close}
      />
    );
  });
const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent === label);
const button = (label: string) => buttons(label)[0];
const click = (label: string) =>
  act(async () => {
    button(label)!.click();
  });
const input = (value: string) =>
  act(async () => {
    const el = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.list.mockResolvedValue(data);
  h.write.mockResolvedValue({ ...data, projectVersion: 8 });
  h.open.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("validates the title and serializes repeated submit taps", async () => {
  await render();
  await click("studioChapters.create");
  expect(button("studioChapters.confirm").disabled).toBe(true);
  await input("New");
  await act(async () => {
    button("studioChapters.confirm").click();
    button("studioChapters.confirm").click();
  });
  expect(h.write).toHaveBeenCalledTimes(1);
  expect(h.write).toHaveBeenCalledWith(
    data,
    { kind: "create", title: "New" },
    1,
    expect.any(AbortSignal)
  );
});
it("requires confirmation to archive and disables archiving the final chapter", async () => {
  await render();
  await click("studioChapters.archive");
  expect(h.write).not.toHaveBeenCalled();
  expect(host.textContent).toContain(rows[0].title);
  await click("studioChapters.confirm");
  expect(h.write).toHaveBeenCalledWith(
    data,
    { kind: "archive", id: rows[0].id },
    1,
    expect.any(AbortSignal)
  );
  h.list.mockResolvedValue({ ...data, sections: [rows[0]] });
  await click("studioChapters.refresh");
  expect(button("studioChapters.archive").disabled).toBe(true);
});
it("moves chapters with the complete ordered ID set", async () => {
  await render();
  expect(button("studioChapters.up").disabled).toBe(true);
  await click("studioChapters.down");
  expect(h.write).toHaveBeenCalledWith(
    data,
    { kind: "reorder", ids: [rows[1].id, rows[0].id] },
    1,
    expect.any(AbortSignal)
  );
});
it("viewers can open a chapter but cannot mutate", async () => {
  h.list.mockResolvedValue({ ...data, canEdit: false });
  await render();
  expect(button("studioChapters.create")).toBeUndefined();
  expect(button("studioChapters.rename")).toBeUndefined();
  await click("studioChapters.open");
  expect(h.open).toHaveBeenCalledWith(
    `https://studio.fizzdragon.com/project/${projectId}/canvas?ws=${workspaceId}&section=${rows[0].id}`
  );
});
it("retains failed edits and blocks retries until reload and explicit review", async () => {
  h.write.mockRejectedValue(new SectionWriteError("Lost response"));
  await render();
  await click("studioChapters.rename");
  await input("Draft");
  await click("studioChapters.confirm");
  expect(host.querySelector("input")!.value).toBe("Draft");
  expect(button("studioChapters.confirm").disabled).toBe(true);
  await click("studioChapters.refresh");
  expect(host.querySelector("input")!.value).toBe("Draft");
  expect(button("studioChapters.confirm").disabled).toBe(true);
  await click("studioProjects.reviewed");
  expect(button("studioChapters.confirm").disabled).toBe(false);
  expect(h.write).toHaveBeenCalledTimes(1);
});
it("preserves edits across backgrounding and clears on account change", async () => {
  await render();
  await click("studioChapters.rename");
  await input("Draft");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.active = true;
  await render();
  expect(host.querySelector("input")!.value).toBe("Draft");
  h.generation++;
  await render();
  expect(host.textContent).toBe("");
});

it("keeps the draft but blocks confirmation while refreshing and after an access downgrade", async () => {
  await render();
  await click("studioChapters.rename");
  await input("My retained title");
  let resolve!: (value: typeof data) => void;
  h.list.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.querySelector("input")!.value).toBe("My retained title");
  expect(button("studioChapters.confirm").disabled).toBe(true);
  await act(async () => resolve({ ...data, canEdit: false }));
  expect(host.textContent).toContain("studioChapters.readOnly");
  await click("studioChapters.confirm");
  expect(h.write).not.toHaveBeenCalled();
  h.list.mockResolvedValue(data);
  await click("studioChapters.refresh");
  expect(host.querySelector("input")!.value).toBe("My retained title");
  expect(button("studioChapters.confirm").disabled).toBe(false);
});
it("requires review of changed chapters before rebasing a retained draft", async () => {
  await render();
  await click("studioChapters.rename");
  await input("My retained title");
  const fresh = {
    ...data,
    projectVersion: 8,
    sections: [{ ...rows[0], title: "Remote edit", version: 2 }, rows[1]],
  };
  h.list.mockResolvedValue(fresh);
  await click("studioChapters.refresh");
  expect(host.querySelector("input")!.value).toBe("My retained title");
  expect(host.textContent).toContain("Remote edit");
  expect(button("studioChapters.confirm").disabled).toBe(true);
  await click("studioProjects.reviewed");
  expect(h.write).not.toHaveBeenCalled();
  await click("studioChapters.confirm");
  expect(h.write).toHaveBeenCalledWith(
    fresh,
    { kind: "rename", id: rows[0].id, title: "My retained title" },
    1,
    expect.any(AbortSignal)
  );
});
it("retains drafts on failed refresh and does not revive a removed chapter", async () => {
  await render();
  await click("studioChapters.rename");
  await input("My retained title");
  h.list.mockRejectedValue(new Error("Access unavailable"));
  await click("studioChapters.refresh");
  expect(host.textContent).toContain("Access unavailable");
  expect(button("studioChapters.confirm").disabled).toBe(true);
  expect(host.querySelector("input")!.value).toBe("My retained title");
  h.list.mockResolvedValue({ ...data, projectVersion: 8, sections: [rows[1]] });
  await click("studioChapters.refresh");
  expect(host.textContent).toContain("studioChapters.missing");
  expect(button("studioProjects.reviewed")).toBeUndefined();
  expect(button("studioChapters.confirm").disabled).toBe(true);
  expect(host.querySelector("input")!.value).toBe("My retained title");
});
