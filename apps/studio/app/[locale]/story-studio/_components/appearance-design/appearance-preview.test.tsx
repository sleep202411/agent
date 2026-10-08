// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoryProjectSummary } from "@/lib/story-projects-api";
import { setApiWorkspaceId } from "@/lib/api";
import { AppearancePreview } from "./appearance-preview";

vi.mock("next-intl", () => ({
  useLocale: () => activeLocale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./appearance-split-panels", () => ({
  AppearanceSplitPanels: ({
    preview,
    chat,
    chatVisible,
  }: {
    preview: ReactNode;
    chat: ReactNode;
    chatVisible: boolean;
  }) => (
    <main>
      {preview}
      {chatVisible && chat}
    </main>
  ),
}));

const PROJECT = "019f60f4-b101-70d4-8000-000000000002";
const OTHER_PROJECT = "019f60f4-b101-70d4-8000-000000000007";
const ID = "019f60f4-b101-70d4-8000-000000000003";
const RESTORED_REQUEST = "019f60f4-b101-70d4-8000-000000000006";
const path = (id = PROJECT) => `/aurora/game-agent/projects/${id}/appearance/web`;
function project(
  id = PROJECT,
  capabilities: StoryProjectSummary["capabilities"] = ["story.edit", "story.generate"]
): StoryProjectSummary {
  return {
    id,
    capabilities,
    canMove: false,
    workspaceId: "workspace",
    frameProfile: "landscape_16_9",
    frameProfileMutable: true,
    durationPreset: null,
    visualStyle: null,
    creativeProfileConfirmedAt: null,
    status: "active",
    visibility: "private",
    title: "Story",
    summary: null,
    defaultLocale: "en-US",
    cover: null,
    tags: [],
    storeListing: null,
    appearance: null,
    gameUi: null,
    sourceIpId: null,
    projectVersion: 1,
    draftRevision: 1,
    production: {
      referenceSlotCount: 0,
      approvedReferenceCount: 0,
      clipCount: 0,
      currentVideoCount: 0,
      latestBuildStatus: null,
    },
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
  };
}

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;
let pollStatuses: number[];
let sessionUrl: ((endpoint: string) => string) | null;
let activeLocale = "en-US";
let sessionIdentity: ((body: Record<string, unknown>) => string) | null;
const requests: Array<{ endpoint: string; init: RequestInit; body: Record<string, unknown> }> = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  sessionStorage.clear();
  setApiWorkspaceId("ambient-workspace-must-not-leak");
  requests.length = 0;
  pollStatuses = [];
  sessionUrl = null;
  sessionIdentity = null;
  activeLocale = "en-US";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit) => {
      const endpoint = String(input);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push({ endpoint, init, body });
      if (body.action === "open") {
        const id = sessionIdentity?.(body) ?? ID;
        return Response.json({
          code: 200,
          data: {
            id,
            leaseId: body.leaseId,
            requestId: RESTORED_REQUEST,
            url: sessionUrl?.(endpoint) ?? `${endpoint}/${id}/`,
          },
        });
      }
      if (body.action === "poll") {
        const status = pollStatuses.shift() ?? 200;
        return status === 200
          ? Response.json({ code: 200, data: { result: null } })
          : Response.json({ message: "Appearance session expired." }, { status });
      }
      return Response.json({ code: 200, data: { closed: true } });
    })
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  queryClient.clear();
  setApiWorkspaceId(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(
  props: { projectId?: string; project?: StoryProjectSummary } = {
    projectId: PROJECT,
    project: project(),
  }
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AppearancePreview {...props} renderStage={() => <button>Preview</button>} />
      </QueryClientProvider>
    )
  );
}

it("opens only within an existing matching project with edit and generation capabilities", async () => {
  await render({});
  await render({ projectId: PROJECT });
  await render({ projectId: PROJECT, project: project(OTHER_PROJECT) });
  await render({ projectId: PROJECT, project: project(PROJECT, ["story.read", "story.generate"]) });
  await render({ projectId: PROJECT, project: project(PROJECT, ["story.read", "story.edit"]) });
  expect(requests).toHaveLength(0);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).toContain("Preview");
});

it("uses project-scoped FD API requests and a window UUID without browser trust metadata", async () => {
  await render();
  const open = requests.find(({ body }) => body.action === "open")!;
  expect(open.endpoint).toBe(path());
  expect(open.body.key).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
  );
  for (const field of ["scope", "parentOrigin", "copy", "workspace", "projectId", "userId"])
    expect(open.body).not.toHaveProperty(field);
  expect(new Headers(open.init.headers).has("x-fizz-workspace-id")).toBe(false);
  expect(open.init.credentials).toBe("include");
  expect(requests.find(({ body }) => body.action === "poll")?.endpoint).toBe(path());
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(`${path()}/${ID}/`);
});

it("rejects private, foreign or incorrectly scoped iframe URLs", async () => {
  sessionUrl = () => `http://localhost:12345/?token=private-token`;
  await render();
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).toContain("does not match this project");
  expect(host.innerHTML).not.toContain("private-token");
});

it("accepts draft messages only from the mounted same-origin Harness window", async () => {
  await render();
  const frame = host.querySelector("iframe")!;
  const send = async (source: Window, origin: string, text: string) => {
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: { type: "fizz.appearance.draft", text },
        })
      )
    );
  };
  await send(frame.contentWindow!, "https://other.example", "foreign");
  await send(window, window.location.origin, "wrong window");
  const storage = `fizzdragon.appearance-ux.v1:${PROJECT}`;
  expect(localStorage.getItem(storage)).toBeNull();
  await send(frame.contentWindow!, window.location.origin, "keep this draft");
  expect(JSON.parse(localStorage.getItem(storage)!).prompt).toBe("keep this draft");
});

it("reopens an expired durable session once and remounts its unchanged iframe URL without a retry loop", async () => {
  pollStatuses = [200, 404, 410];
  await render();
  const initialFrame = host.querySelector("iframe");
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(requests.filter(({ body }) => body.action === "open")).toHaveLength(2);
  expect(host.querySelector("iframe")).not.toBe(initialFrame);
  expect(host.textContent).toContain("Appearance session expired.");
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(requests.filter(({ body }) => body.action === "open")).toHaveLength(2);
  const reconnect = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "chat.reconnect"
  )!;
  await act(async () => reconnect.click());
  expect(requests.filter(({ body }) => body.action === "open")).toHaveLength(3);
});

it("releases the captured old project lease when switching projects or losing permission", async () => {
  await render();
  const oldLease = requests.find(({ body }) => body.action === "open")!.body.leaseId;
  await render({ projectId: OTHER_PROJECT, project: project(OTHER_PROJECT) });
  const close = requests.find(({ body }) => body.action === "close")!;
  expect(close.endpoint).toBe(path());
  expect(close.body).toEqual({ action: "close", id: ID, leaseId: oldLease });
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(`${path(OTHER_PROJECT)}/${ID}/`);
  await render({ projectId: OTHER_PROJECT, project: project(OTHER_PROJECT, ["story.read"]) });
  expect(requests.filter(({ body }) => body.action === "close").at(-1)?.endpoint).toBe(
    path(OTHER_PROJECT)
  );
  expect(host.querySelector("iframe")).toBeNull();
});

it("releases the old locale session and admits the new locale without leaving its child running", async () => {
  const chineseSession = "019f60f4-b101-70d4-8000-000000000008";
  sessionIdentity = (body) =>
    (body.request as { locale: string }).locale === "zh-CN" ? chineseSession : ID;
  await render();
  const oldFrame = host.querySelector("iframe");
  const originalLease = requests.find(({ body }) => body.action === "open")!.body.leaseId;
  activeLocale = "zh-CN";
  await render();
  expect(requests.filter(({ body }) => body.action === "close")).toEqual([
    expect.objectContaining({
      endpoint: path(),
      body: { action: "close", id: ID, leaseId: originalLease },
    }),
  ]);
  const opens = requests.filter(({ body }) => body.action === "open");
  expect(opens).toHaveLength(2);
  expect((opens[1]!.body.request as { locale: string }).locale).toBe("zh-CN");
  expect(opens[1]!.body.key).toBe(opens[0]!.body.key);
  expect(host.querySelector("iframe")).not.toBe(oldFrame);
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(`${path()}/${chineseSession}/`);
});
