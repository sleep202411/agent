// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSkillsPanel } from "./project-skills-panel";
const mocks = vi.hoisted(() => ({
  importSkill: vi.fn(),
  select: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/project-skills-api", () => ({
  importProjectSkill: mocks.importSkill,
  installProjectSkill: vi.fn(),
  uninstallProjectSkill: vi.fn(),
  setProjectSkillDefaults: vi.fn(),
}));
vi.mock("./project-context", () => ({
  useProjectContext: () => ({
    owner: { kind: "platform_project", projectId: "P" },
    projectSkills: { data: { projectRevision: 3, installations: [] } },
    projectSkillCatalog: {
      data: { items: [], canManage: true, canManageWorkspace: true },
      loading: false,
    },
  }),
}));
vi.mock("../_stores/project-ui-store", () => ({
  useProjectUIStore: (select: (state: unknown) => unknown) =>
    select({ closeSkills: vi.fn(), selectedSkillId: null, selectSkill: mocks.select }),
}));
vi.mock("@/components/ui/drawer-panel", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { DrawerPanel: { Header: Box, Body: Box, Footer: Box } };
});
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: Box,
    DialogHeader: Box,
    DialogTitle: Box,
    DialogDescription: Box,
    DialogFooter: Box,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
let resolve: (v: unknown) => void, reject: (reason: Error) => void;
const file = new File(["instructions"], "SKILL.md", { type: "text/markdown" });
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.importSkill.mockImplementation(
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      })
  );
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectSkillsPanel />
      </QueryClientProvider>
    )
  );
  await act(async () => button("upload.open").click());
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
function button(text: string) {
  const b = Array.from(
    (host.querySelector('[role="dialog"]') ?? host).querySelectorAll("button")
  ).find((b) => b.textContent?.trim() === text);
  if (!b) throw new Error(text);
  return b;
}
function scope(name: string) {
  return Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(`upload.scopes.${name}`)
  )!;
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
it("locks the file, visibility scope and kind while the selected package is imported", async () => {
  await act(async () => button("upload.confirm").click());
  await flush();
  expect(mocks.importSkill).toHaveBeenCalledWith(
    expect.objectContaining({ file, scope: "project", kind: "general" })
  );
  expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
  expect(scope("workspace").disabled).toBe(true);
  expect(button("filters.image").disabled).toBe(true);
});
it("unlocks the same draft for correction and retry after failure", async () => {
  await act(async () => button("upload.confirm").click());
  await flush();
  reject(new Error("Upload failed"));
  await flush();
  expect(host.textContent).toContain("SKILL.md");
  expect(scope("workspace").disabled).toBe(false);
  await act(async () => {
    scope("workspace").click();
    button("filters.image").click();
  });
  await act(async () => button("upload.confirm").click());
  await flush();
  expect(mocks.importSkill).toHaveBeenLastCalledWith(
    expect.objectContaining({ file, scope: "workspace", kind: "image" })
  );
});
it("closes and selects the imported skill after success", async () => {
  await act(async () => button("upload.confirm").click());
  await flush();
  resolve({ skill: { id: "imported", name: "My skill" } });
  await flush();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.select).toHaveBeenCalledWith("imported");
});
