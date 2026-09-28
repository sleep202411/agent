// @vitest-environment jsdom
import { act, type ReactNode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudioComposer } from "../(studio)/_components/generation/studio-composer";
import { CreativeComposer } from "./creative-composer";
import { useComposerDraftStore } from "../(studio)/_components/generation/use-composer-draft";
import { useImageGeneration } from "../(studio)/_components/generation/use-image-generation";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  submit: vi.fn(),
  create: vi.fn(),
  requireAuth: vi.fn(),
  userId: "owner" as string | null,
  workspaceId: "workspace" as string | null,
  props: {} as ComponentProps<typeof StudioComposer>,
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: state.userId ? { id: state.userId } : null,
    requireAuth: state.requireAuth,
  }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ activeWorkspace: state.workspaceId ? { id: state.workspaceId } : null }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectPayerWorkspace: () => (state.workspaceId ? { id: state.workspaceId } : null),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/collab/projects-api", () => ({ createProject: state.create }));
vi.mock("@/app/_components/credits-badge", () => ({
  useComputeWalletBalance: () => ({ data: undefined }),
}));
vi.mock("../(studio)/_components/generation/use-generation-feed", () => ({
  useGenerationFeed: () => ({ submit: state.submit }),
}));
vi.mock("../(studio)/_components/generation/use-reference-uploads", () => ({
  generationReferencesFromUploads: () => ({}),
  useReferenceUploads: () => ({ items: [], addFiles: vi.fn(), remove: vi.fn() }),
}));
vi.mock("@/lib/canvas-authoring/use-ai-catalog", () => ({
  useAiCatalog: () => ({ data: {} }),
  usableModelsByModality: (_catalog: unknown, kind: string) => [
    {
      id: kind,
      name: kind,
      type: kind,
      schemaVersion: "1",
      enabled: true,
      generationModes: [kind === "image" ? "text_to_image" : "text_to_video"],
      input_schema: { properties: { prompt: { type: "string" }, aspectRatio: { type: "string" } } },
    },
  ],
}));
vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange: (value: string) => void;
  }) => (
    <div
      onClick={(e) => {
        const value = (e.target as HTMLElement).closest("button")?.value;
        if (value) onValueChange(value);
      }}
    >
      {children}
    </div>
  ),
  ToggleGroupItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <button value={value}>{children}</button>
  ),
}));
vi.mock("../(studio)/_components/generation/studio-composer", () => ({
  StudioComposer: (props: ComponentProps<typeof StudioComposer>) => {
    state.props = props;
    return (
      <div>
        <textarea value={props.prompt} onChange={(e) => props.onPromptChange(e.target.value)} />
        <button data-create disabled={!props.canSubmit} onClick={props.onRequestSubmit}>
          Create
        </button>
        {props.error && <p role="alert">{props.error}</p>}
      </div>
    );
  },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.userId = "owner";
  state.workspaceId = "workspace";
  useComposerDraftStore.setState({ drafts: {} });
  state.submit.mockResolvedValue({ ok: true });
  state.create.mockResolvedValue({ id: "new-project" });
  state.requireAuth.mockImplementation((action) => action());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<CreativeComposer />));
}
async function prompt(text: string) {
  await act(async () => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(kind: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`button[value="${kind}"]`)!.click());
}
async function submit() {
  await act(async () => host.querySelector<HTMLButtonElement>("[data-create]")!.click());
}
it.each(["image", "video"])("submits %s on Home before opening its history", async (kind) => {
  await render();
  await prompt("夜景 & rain");
  await choose(kind);
  await submit();
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit.mock.calls[0][0]).toMatchObject({ modelId: kind, prompt: "夜景 & rain" });
  expect(state.push).toHaveBeenCalledExactlyOnceWith(kind === "image" ? "/images" : "/video");
});
it("keeps failures on Home with the prompt available for retry", async () => {
  state.submit.mockResolvedValueOnce({ ok: false, error: "Provider unavailable" });
  await render();
  await prompt("retry this");
  await submit();
  expect(state.push).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Provider unavailable");
  expect(host.querySelector("textarea")?.value).toBe("retry this");
  await submit();
  expect(state.push).toHaveBeenCalledTimes(1);
});
it("claims rapid submissions once while the job is being accepted", async () => {
  let finish!: (result: { ok: boolean }) => void;
  state.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await prompt("once");
  const request = state.props.onRequestSubmit!;
  await act(async () => {
    request();
    request();
  });
  expect(state.submit).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true }));
  expect(state.push).toHaveBeenCalledTimes(1);
});
it("shares model settings and prompt with the image tool after navigation", async () => {
  await render();
  await prompt("shared");
  await act(async () => state.props.onSettingsChange({ aspectRatio: "16:9" }));
  let tool: ReturnType<typeof useImageGeneration>;
  function Tool() {
    tool = useImageGeneration();
    return null;
  }
  await act(async () => root.render(<Tool />));
  expect(tool!.prompt).toBe("shared");
  expect(tool!.settings).toEqual({ aspectRatio: "16:9" });
  await act(async () => tool!.setPrompt("edited in Image"));
  await render();
  expect(host.querySelector("textarea")?.value).toBe("edited in Image");
});
it("preserves the prompt across all three modality tabs", async () => {
  await render();
  await prompt("one idea");
  for (const kind of ["video", "project", "image"]) {
    await choose(kind);
    expect(host.querySelector("textarea")?.value).toBe("one idea");
  }
});
it("creates a canvas with a FizzAgent prompt handoff", async () => {
  await render();
  await prompt("plan & shoot");
  await choose("project");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="composer.createAria"]')!.click()
  );
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.create.mock.calls[0]).toMatchObject(["workspace", { description: "plan & shoot" }]);
  expect(state.push).toHaveBeenCalledExactlyOnceWith(
    "/project/new-project/canvas?prompt=plan%20%26%20shoot"
  );
});
it("resumes a guest image submission after sign-in and workspace hydration", async () => {
  state.userId = null;
  state.workspaceId = null;
  state.requireAuth.mockImplementation(() => {});
  await render();
  await prompt("guest idea");
  await submit();
  expect(state.submit).not.toHaveBeenCalled();
  await act(async () => state.requireAuth.mock.calls[0][0]());
  state.userId = "owner";
  state.workspaceId = "workspace";
  await render();
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit.mock.calls[0][0].prompt).toBe("guest idea");
});
it.each(["edit", "unmount"])("abandons deferred sign-in after %s", async (change) => {
  state.requireAuth.mockImplementation(() => {});
  await render();
  await prompt("old idea");
  await submit();
  if (change === "edit") await prompt("new idea");
  else await act(async () => root.render(null));
  await act(async () => state.requireAuth.mock.calls[0][0]());
  expect(state.submit).not.toHaveBeenCalled();
});
it("does not expose a previous account or workspace's draft", async () => {
  await render();
  await prompt("private");
  state.workspaceId = "other";
  await render();
  expect(host.querySelector("textarea")?.value).toBe("");
  await prompt("other workspace");
  state.userId = "other-owner";
  await render();
  expect(host.querySelector("textarea")?.value).toBe("");
});

it("resumes a guest Project submission with its original prompt", async () => {
  state.userId = null;
  state.workspaceId = null;
  state.requireAuth.mockImplementation(() => {});
  await render();
  await choose("project");
  await prompt("guest canvas");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="composer.createAria"]')!.click()
  );
  await act(async () => state.requireAuth.mock.calls[0][0]());
  state.userId = "owner";
  state.workspaceId = "workspace";
  await render();
  expect(state.create).toHaveBeenCalledExactlyOnceWith(
    "workspace",
    expect.objectContaining({ description: "guest canvas" })
  );
  expect(state.push).toHaveBeenCalledExactlyOnceWith(
    "/project/new-project/canvas?prompt=guest%20canvas"
  );
});
it("does not create a second generation while navigation is pending", async () => {
  await render();
  await prompt("once");
  await submit();
  await submit();
  expect(state.submit).toHaveBeenCalledTimes(1);
});
it("keeps the project prompt isolated after switching accounts", async () => {
  await render();
  await choose("project");
  await prompt("private project");
  state.userId = "another-owner";
  await render();
  expect(host.querySelector("textarea")?.value).toBe("");
});
it("does not navigate to a project after the user switches workspaces during creation", async () => {
  let finish!: (value: { id: string }) => void;
  state.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await choose("project");
  await prompt("old workspace");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="composer.createAria"]')!.click()
  );
  state.workspaceId = "new-workspace";
  await render();
  await act(async () => finish({ id: "created-in-old-workspace" }));
  expect(state.push).not.toHaveBeenCalled();
});
