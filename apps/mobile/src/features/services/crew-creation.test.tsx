import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewCreation } from "./crew-creation";
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/config", () => ({
  appEnv: { assets: { bannerBaseUrl: "https://assets.test" } },
  resolveAssetUrl: (path: string) => path,
}));
const h = vi.hoisted(() => ({
  generation: 1,
  corrupt: false,
  focused: true,
  pending: null as unknown,
  load: vi.fn(),
  owned: vi.fn(),
  create: vi.fn(),
  clear: vi.fn(),
  logo: vi.fn(),
  workspaces: vi.fn(),
  projects: vi.fn(),
  canvas: vi.fn(),
  created: vi.fn(),
  close: vi.fn(),
  certification: vi.fn(),
  mine: vi.fn(),
  activity: undefined as undefined | ((active: boolean) => void),
}));
vi.mock("./crew-creation-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./crew-creation-api")>();
  return {
    ...real,
    fetchCrewCreationEligibility: h.load,
    fetchCrewsForCreationReview: h.owned,
    createMobileCrew: h.create,
    fetchCrewCreationCanvas: h.canvas,
    crewCreationPending: () => ({
      read: () => {
        if (h.corrupt) throw new Error("Invalid saved request");
        return h.pending;
      },
      clear: h.clear,
    }),
  };
});
vi.mock("./crew-logo-upload", () => ({ pickCrewLogo: h.logo }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentProjects: h.projects,
  loadAgentWorkspaces: h.workspaces,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({
  useAppActiveChange: (fn: (active: boolean) => void) => {
    h.activity = fn;
  },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({
  PosterImage: ({ uri }: { uri: string }) => <img src={uri} alt="logo" />,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      value={value}
      disabled={!editable}
      aria-label={accessibilityLabel}
      onInput={(e) => onChangeText(e.currentTarget.value)}
    />
  ),
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Owned Studio" };
const projectId = "22222222-2222-4222-8222-222222222222";
const payload = () => ({
  name: "Crew",
  description: "Production",
  logo: "https://static.fizzspace.cn/static/pc/crew_icon_default.png",
  productionTemplateLocale: "en-US",
  productionKind: "series",
  studioWorkspaceId: workspace.id,
});
const saved = (receipt = false) => ({
  input: payload(),
  startedAt: "2026-10-02T00:00:00.000Z",
  ...(receipt ? { receipt: { ...payload(), id: "new-crew", ownerUserId: "user" } } : {}),
});
const render = () =>
  act(async () =>
    root.render(
      <CrewCreation
        userId="user"
        generation={1}
        onCreated={h.created}
        onClose={h.close}
        onCertification={h.certification}
      />
    )
  );
const find = (key: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === key);
const click = (key: string) =>
  act(async () => {
    const button = find(key);
    expect(button).toBeDefined();
    button!.click();
  });
const fill = (key: string, value: string) =>
  act(async () => {
    const input = host.querySelector(`input[aria-label="${key}"]`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const details = async () => {
  await fill("crewCreate.createNameLabel", "Crew");
  await fill("crewCreate.createDescriptionLabel", "Production");
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.corrupt = false;
  h.focused = true;
  h.pending = null;
  h.owned.mockResolvedValue([]);
  h.load.mockResolvedValue({ eligible: true, workspaces: [workspace] });
  h.create.mockImplementation(async () => {
    h.pending = saved(true);
    return { id: "new-crew" };
  });
  h.clear.mockImplementation(() => {
    h.corrupt = false;
    h.pending = null;
  });
  h.logo.mockResolvedValue("uploaded-logo.png");
  h.workspaces.mockResolvedValue([workspace]);
  h.projects.mockResolvedValue({
    workspaceId: workspace.id,
    projects: [{ id: projectId, workspaceId: workspace.id, title: "My Film" }],
  });
  h.canvas.mockResolvedValue({
    projectId,
    title: "My Film",
    plotTree: {
      title: "Film",
      description: "",
      startNodeId: "end",
      nodes: [{ id: "end", type: "ending", content: {}, transitions: [] }],
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("does not create until complete details are reviewed and confirmed", async () => {
  await render();
  await click("crewCreate.review");
  expect(host.textContent).toContain("crewCreate.invalid");
  expect(h.create).not.toHaveBeenCalled();
  await details();
  await click("crewCreate.review");
  expect(h.create).not.toHaveBeenCalled();
  expect((host.querySelector("input") as HTMLInputElement).disabled).toBe(true);
  await click("crewCreate.confirm");
  expect(h.create).toHaveBeenCalledWith(payload(), "user", 1, expect.any(AbortSignal));
  expect(host.textContent).toContain("crewCreate.createSuccess");
  await click("crewSetup.title");
  expect(h.created).toHaveBeenCalledWith("new-crew");
});
it("allows editing a reviewed request and validates the new workspace name", async () => {
  await render();
  await details();
  await click("crewCreate.review");
  await click("crewCreate.edit");
  await click("crewCreate.createWorkspaceNew");
  await fill("crewCreate.createWorkspaceNamePlaceholder", "New Studio");
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(h.create.mock.calls[0][0]).toMatchObject({
    createStudioWorkspace: { name: "New Studio" },
  });
  expect(h.create.mock.calls[0][0]).not.toHaveProperty("studioWorkspaceId");
});
it("supports creating when no existing workspace is available", async () => {
  h.load.mockResolvedValue({ eligible: true, workspaces: [] });
  await render();
  await details();
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(h.create.mock.calls[0][0]).toMatchObject({ createStudioWorkspace: { name: "Crew" } });
});
it("hides creation controls when eligibility is denied or fails", async () => {
  h.load.mockResolvedValue({ eligible: false, workspaces: [] });
  await render();
  expect(host.textContent).toContain("crewCreate.eligibility");
  await click("levelApplication.title");
  expect(h.certification).toHaveBeenCalledOnce();
  expect(find("crewCreate.review")).toBeUndefined();
  h.load.mockRejectedValue(new Error("Permission lookup failed"));
  await click("thread.refresh");
  expect(host.textContent).toContain("Permission lookup failed");
  expect(find("crewCreate.review")).toBeUndefined();
});
it("restores an uncertain attempt without POST or eligibility reads and requires explicit clearance", async () => {
  h.pending = saved();
  await render();
  expect(h.load).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewCreate.pending");
  await click("crewCreate.myCrewsTitle");
  expect(h.owned).toHaveBeenCalledWith("user", 1, expect.any(AbortSignal));
  await click("crewSetup.back");
  await click("crewCreate.clear");
  expect(h.clear).not.toHaveBeenCalled();
  await click("crewCreate.confirmClear");
  expect(h.clear).toHaveBeenCalledOnce();
  expect(h.load).toHaveBeenCalledOnce();
});
it("restores a verified receipt and navigates without creating another Crew", async () => {
  h.pending = saved(true);
  await render();
  await click("crewSetup.title");
  expect(h.created).toHaveBeenCalledWith("new-crew");
  expect(h.create).not.toHaveBeenCalled();
});
it("shows the preserved pending request after a lost response", async () => {
  h.create.mockImplementation(async () => {
    h.pending = saved();
    throw new Error("Connection lost");
  });
  await render();
  await details();
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(host.textContent).toContain("Connection lost");
  expect(host.textContent).toContain("crewCreate.pending");
  expect(find("crewCreate.confirm")).toBeUndefined();
});
it("keeps the form after a preflight rejection that did not send a request", async () => {
  h.create.mockRejectedValue(new Error("Workspace no longer available"));
  await render();
  await details();
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(host.textContent).toContain("Workspace no longer available");
  expect(find("crewCreate.edit")).toBeDefined();
});
it("uploads a logo and submits its path without mutating the profile", async () => {
  await render();
  await details();
  await click("crewCreate.createLogoPickHint");
  expect(h.logo).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(h.create.mock.calls[0][0].logo).toBe("uploaded-logo.png");
});
it("selects a workspace-scoped film and imports the reviewed canvas only for interactive production", async () => {
  await render();
  await details();
  await click("crewCreate.createProductionKindFilm");
  await click("crewCreate.importFromCanvas");
  await click("Owned Studio");
  await click("My Film");
  expect(h.canvas).toHaveBeenCalledWith(workspace.id, projectId, 1, expect.any(AbortSignal));
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(h.create.mock.calls[0][0]).toMatchObject({
    productionKind: "interactive_film",
    plotTree: { title: "Film" },
  });
});
it("switching back to series clears the selected canvas", async () => {
  await render();
  await details();
  await click("crewCreate.createProductionKindFilm");
  await click("crewCreate.importFromCanvas");
  await click("Owned Studio");
  await click("My Film");
  await click("crewCreate.createProductionKindSeries");
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(h.create.mock.calls[0][0]).not.toHaveProperty("plotTree");
});
it("aborts in-flight creation when the form loses focus", async () => {
  h.create.mockReturnValue(new Promise(() => {}));
  await render();
  await details();
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  const signal = h.create.mock.calls[0][3] as AbortSignal;
  h.focused = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toBe("");
});
it("removes the old account's form and aborts its eligibility read", async () => {
  h.load.mockReturnValue(new Promise(() => {}));
  await render();
  const signal = h.load.mock.calls[0][1] as AbortSignal;
  h.generation = 2;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toBe("");
});

it("requires explicit recovery when the saved request is corrupt", async () => {
  h.corrupt = true;
  await render();
  expect(host.textContent).toContain("Invalid saved request");
  expect(find("crewCreate.confirm")).toBeUndefined();
  await click("crewCreate.clear");
  expect(h.clear).not.toHaveBeenCalled();
  await click("crewCreate.confirmClear");
  expect(h.clear).toHaveBeenCalledOnce();
  expect(find("crewCreate.review")).toBeDefined();
});
it("ignores a rapid second confirmation without aborting the first request", async () => {
  h.create.mockReturnValue(new Promise(() => {}));
  await render();
  await details();
  await click("crewCreate.review");
  await act(async () => {
    find("crewCreate.confirm")!.click();
    find("crewCreate.confirm")!.click();
  });
  expect(h.create).toHaveBeenCalledOnce();
  expect(h.create.mock.calls[0][3].aborted).toBe(false);
});
it("reloads interrupted initial eligibility when returning to foreground", async () => {
  h.load.mockReturnValueOnce(new Promise(() => {}));
  await render();
  const signal = h.load.mock.calls[0][1] as AbortSignal;
  await act(async () => h.activity!(false));
  expect(signal.aborted).toBe(true);
  await act(async () => h.activity!(true));
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(find("crewCreate.review")).toBeDefined();
});
it("does not abort the native image picker on its temporary background transition", async () => {
  let finish!: (value: string) => void;
  h.logo.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await click("crewCreate.createLogoPickHint");
  const signal = h.logo.mock.calls[0][1] as AbortSignal;
  await act(async () => h.activity!(false));
  expect(signal.aborted).toBe(false);
  await act(async () => {
    h.activity!(true);
    finish("logo.png");
  });
  await details();
  await click("crewCreate.review");
  await click("crewCreate.confirm");
  expect(h.create.mock.calls[0][0].logo).toBe("logo.png");
});

it("surfaces a failed recovery-directory read and never presents it as an empty success", async () => {
  h.pending = saved();
  h.owned.mockRejectedValue(new Error("Crew directory unavailable"));
  await render();
  await click("crewCreate.myCrewsTitle");
  expect(host.textContent).toContain("Crew directory unavailable");
  expect(h.created).not.toHaveBeenCalled();
  expect(h.clear).not.toHaveBeenCalled();
  h.owned.mockResolvedValue([
    { ...payload(), id: "older", ownerUserId: "user", createdAt: "2026-10-01T00:00:00Z" },
  ]);
  await click("thread.refresh");
  await click("Crew");
  expect(h.created).toHaveBeenCalledWith("older");
  expect(h.clear).not.toHaveBeenCalled();
});
