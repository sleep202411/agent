import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSkillsPanel } from "./project-skills-panel";
const state = vi.hoisted(() => ({
  defaults: vi.fn(),
  latest: ["image_generation"],
  pinned: ["video_generation"],
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/project-skills-api", () => ({
  installProjectSkill: vi.fn(),
  importProjectSkill: vi.fn(),
  uninstallProjectSkill: vi.fn(),
  setProjectSkillDefaults: state.defaults,
}));
vi.mock("../_stores/project-ui-store", () => ({
  useProjectUIStore: (select: (store: unknown) => unknown) =>
    select({ selectedSkillId: "skill", selectSkill: vi.fn(), closeSkills: vi.fn() }),
}));
vi.mock("./project-context", () => ({
  useProjectContext: () => ({
    owner: { kind: "platform_project", projectId: "project" },
    projectSkills: { data: { projectRevision: 4, installations: [] } },
    projectSkillCatalog: {
      data: {
        canManage: true,
        items: [
          {
            id: "skill",
            name: "Installed skill",
            slug: "installed",
            description: "Pinned version",
            category: "style",
            publisherName: "Creator",
            kind: "general",
            ownershipScope: "community",
            latestVersion: { capabilities: state.latest },
            installation: {
              id: "installed",
              version: { capabilities: state.pinned },
              defaults: [],
            },
          },
        ],
      },
    },
  }),
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.defaults.mockReset().mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});
it.each([
  {
    latest: ["image_generation"],
    pinned: ["video_generation"],
    expected: "video_generation",
    absent: "image_generation",
  },
  {
    latest: ["video_generation"],
    pinned: ["image_generation"],
    expected: "image_generation",
    absent: "video_generation",
  },
])(
  "offers defaults supported by the installed version: $expected",
  async ({ latest, pinned, expected, absent }) => {
    state.latest = latest;
    state.pinned = pinned;
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <ProjectSkillsPanel />
        </QueryClientProvider>
      )
    );
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.some((button) => button.textContent === `scopes.${absent}`)).toBe(false);
    const supported = buttons.find((button) => button.textContent === `scopes.${expected}`)!;
    expect(supported).toBeDefined();
    await act(async () => supported.click());
    expect(state.defaults).toHaveBeenCalledWith({
      ownerKind: "platform",
      projectId: "project",
      scope: expected,
      installationIds: ["installed"],
      expectedProjectRevision: 4,
    });
  }
);
