// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";
import { CrewAssetsTab } from "./crew-assets-tab";
import { CrewWorkbenchHeader } from "../workbench/crew-workbench-header";
import { CrewTransfersProvider } from "@/app/(site)/crews/[id]/workspace/_components/transfers/crew-transfer-center";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/src/i18n/i18n", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useLocale: () => "en-US",
    useTranslations: (namespace: string) => (key: string, vars?: Record<string, string | number>) =>
      Object.entries(vars ?? {}).reduce<string>(
        (copy, [name, value]) => copy.replaceAll(`{${name}}`, String(value)),
        messages[namespace]?.[key] ?? key
      ),
  };
});

vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, isLoading: false }),
}));

// The linked-workspace picker's "Open in Studio" anchor resolves the
// regional Studio host from env; pin it so jsdom never needs the var.
// Partial mock: keep CURRENT_CELL and friends for crew-money formatting.
vi.mock("@/src/lib/region/cell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/region/cell")>()),
  getStudioHref: () => "https://studio.test",
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/en-US/crews/crew_1/workspace",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <span aria-label={name} />,
}));

const ROOT_ITEMS = [
  {
    id: "folder-1",
    parentId: null,
    name: "Storyboard",
    kind: "folder",
    status: "active",
    accessMode: "inherit",
    permissionVersion: 1,
    effectivePermission: "manage",
    favorite: false,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    trashedAt: null,
    media: null,
  },
  {
    id: "file-1",
    parentId: null,
    name: "concept.png",
    kind: "file",
    status: "active",
    accessMode: "inherit",
    permissionVersion: 1,
    effectivePermission: "manage",
    favorite: true,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    trashedAt: null,
    media: {
      id: "media-1",
      kind: "image",
      contentType: "image/png",
      sizeBytes: 2048,
      width: 1920,
      height: 1080,
      durationSeconds: null,
      previewUrl: "/aurora/media/assets/media-1/content",
    },
  },
] as const;

let root: Root | null = null;
let container: HTMLElement | null = null;
let requests: Array<{ url: string; method: string; body?: unknown }> = [];
let storageAvailable = true;
let paginated = false;
let cursorRejected = false;
let nextPageFails = false;
let assetListFails = false;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

let legacyProject: { id: string; name: string } | null = null;
let canLink = true;
let overviewReadFails = false;
let permissionReadFails = false;
let linkFails = false;
let linkedWorkspaceId: string | null = null;
let folderReadFails = false;
let bulkMove = false;
let allowOrganize = true;
let folderPermission = "manage";
let filePermission = "manage";
let contractLocked = false;
let movedSecond = false;
let memberReadFails = false;
let accessVersion = 1;
let refreshedAsset = false;
let trashFails = false;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (method === "GET" && url.endsWith("/production-overview")) {
        if (overviewReadFails)
          return jsonResponse({ message: "Overview unavailable" }, { status: 403 });
        return jsonResponse({
          studioProject: legacyProject
            ? { ...legacyProject, workspace: { id: "legacy-workspace", name: "Legacy workspace" } }
            : null,
          studioWorkspace: linkedWorkspaceId ? { id: linkedWorkspaceId, name: "Studio" } : null,
          capabilities: { linkWorkspace: canLink },
        });
      }
      if (method === "GET" && url.endsWith("/studio-workspace-options")) {
        return jsonResponse([
          { id: "ws-1", name: "Studio" },
          { id: "ws-2", name: "Film Room" },
        ]);
      }
      if (method === "PATCH" && url.endsWith("/studio-workspace")) {
        if (linkFails) {
          return jsonResponse({ message: "Workspace link changed" }, { status: 403 });
        }
        linkedWorkspaceId = JSON.parse(String(init?.body)).workspaceId;
        legacyProject = null;
        return jsonResponse({ studioWorkspace: { id: "ws-1", name: "Studio" } });
      }
      if (method === "GET" && url.includes("/users/by-ids")) {
        return jsonResponse({
          users: [{ userId: "user-1", nickname: "Lin Mo" }],
        });
      }
      if (method === "GET" && url.endsWith("/assets/context")) {
        return jsonResponse({
          cell: "global",
          provider: "s3_compatible",
          storageAvailable,
          storageUsage: {
            usedBytes: 2e9,
            totalBytes: 100e9,
            remainingBytes: 97e9,
            reservedBytes: 1e9,
            unknownSizeCount: 0,
          },
          maxUploadBytes: 5 * 1024 * 1024 * 1024,
          accessModel: "hierarchical_acl",
          role: "admin",
          capabilities: {
            view: true,
            createFolder: true,
            upload: true,
            organize: allowOrganize,
            trash: true,
            restore: true,
            deleteForever: true,
          },
        });
      }
      if (method === "GET" && url.endsWith("/assets/nodes/nested-folder")) {
        return jsonResponse({
          node: { ...ROOT_ITEMS[0], id: "nested-folder", parentId: "folder-1", name: "Subtitled" },
          path: [{ id: "folder-1", name: "Storyboard" }],
        });
      }
      if (method === "GET" && url.endsWith("/assets/nodes/folder-1")) {
        return jsonResponse({ node: ROOT_ITEMS[0], path: [] });
      }
      if (method === "GET" && url.endsWith("/assets/nodes/file-1")) {
        return jsonResponse({
          node: ROOT_ITEMS[1],
          path: [],
        });
      }
      if (method === "GET" && url.endsWith("/assets/file-1/permissions/events")) {
        return jsonResponse([]);
      }
      if (method === "GET" && url.endsWith("/assets/file-1/permissions")) {
        if (permissionReadFails)
          return jsonResponse({ message: "Access read unavailable" }, { status: 503 });
        return jsonResponse({
          accessMode: "inherit",
          permissionVersion: accessVersion,
          effectivePermission: "manage",
          canManage: true,
          grants: [],
        });
      }
      if (method === "GET" && new URL(url, "http://localhost").pathname.endsWith("/members")) {
        if (memberReadFails)
          return jsonResponse({ message: "Member list unavailable" }, { status: 403 });
        return jsonResponse({ items: [], nextCursor: null, total: 0 });
      }
      if (method === "PATCH" && url.includes("/assets/")) {
        if (url.endsWith("/file-1"))
          return jsonResponse({ message: "Name already exists" }, { status: 409 });
        movedSecond = true;
        return jsonResponse({
          ...ROOT_ITEMS[1],
          id: "file-2",
          name: "second.png",
          parentId: "folder-1",
        });
      }
      if (method === "GET" && url.includes("/assets/studio-media-options")) {
        return jsonResponse({ workspaceId: "ws-1", projects: [], items: [] });
      }
      if (method === "GET" && url.endsWith("/assets/folders")) {
        if (folderReadFails)
          return jsonResponse({ message: "Folders unavailable" }, { status: 503 });
        return jsonResponse([
          ROOT_ITEMS[0],
          { ...ROOT_ITEMS[0], id: "nested-folder", parentId: "folder-1", name: "Subtitled" },
        ]);
      }
      if (method === "GET" && url.includes("/assets")) {
        if (assetListFails)
          return jsonResponse({ message: "Refresh unavailable" }, { status: 503 });
        if (url.includes("cursor=")) {
          if (cursorRejected)
            return jsonResponse(
              { code: "CREW_ASSET_CURSOR_INVALID", message: "Restart assets" },
              { status: 400 }
            );
          return nextPageFails
            ? jsonResponse({ message: "Next page unavailable" }, { status: 503 })
            : jsonResponse({
                items: [{ ...ROOT_ITEMS[1], id: "last", name: "last.png" }],
                nextCursor: null,
                source: "all",
                parentId: null,
              });
        }
        const inFolder = url.includes("parentId=folder-1");
        return jsonResponse({
          items: inFolder
            ? []
            : [
                ...ROOT_ITEMS.map((item) =>
                  refreshedAsset && item.id === "file-1"
                    ? { ...item, name: "Collaborator.png", updatedAt: "2026-09-23T10:00:00.000Z" }
                    : {
                        ...item,
                        contractLocked: item.kind === "file" && contractLocked,
                        effectivePermission:
                          item.kind === "folder" ? folderPermission : filePermission,
                      }
                ),
                ...(bulkMove && !movedSecond
                  ? [{ ...ROOT_ITEMS[1], id: "file-2", name: "second.png" }]
                  : []),
              ],
          parentId: inFolder ? "folder-1" : null,
          source: "all",
          nextCursor: paginated ? "file-1" : null,
        });
      }
      if (method === "POST" && url.endsWith("/assets/folders")) {
        return jsonResponse(
          {
            ...ROOT_ITEMS[0],
            id: "folder-created",
            name: "References",
          },
          { status: 201 }
        );
      }
      if (method === "POST" && trashFails && url.endsWith("/assets/file-1/restore"))
        return jsonResponse({ message: "Asset temporarily unavailable" }, { status: 503 });
      if (method === "PUT" || method === "POST") return jsonResponse({ favorite: true });
      if (method === "DELETE" && trashFails && url.endsWith("/assets/file-1"))
        return jsonResponse({ message: "Asset temporarily unavailable" }, { status: 503 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`Unhandled request: ${method} ${url}`);
    })
  );
}

async function render(initialAssetId?: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <CrewTransfersProvider crewId="crew_1">
          <CrewWorkbenchHeader
            crewId="crew_1"
            crewName="Night Shift"
            pageTitle="Assets"
            showProductionActions
          />
          <CrewAssetsTab crewId="crew_1" initialAssetId={initialAssetId} />
        </CrewTransfersProvider>
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return queryClient;
}

function byText(selector: string, text: string): HTMLElement {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!element) throw new Error(`Element not found: ${selector} ${text}`);
  return element;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  requests = [];
  storageAvailable = true;
  paginated = false;
  nextPageFails = false;
  cursorRejected = false;
  assetListFails = false;
  canLink = true;
  overviewReadFails = false;
  linkFails = false;
  linkedWorkspaceId = null;
  legacyProject = null;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  installFetch();
});

afterEach(() => {
  folderReadFails = false;
  bulkMove = false;
  allowOrganize = true;
  folderPermission = "manage";
  filePermission = "manage";
  contractLocked = false;
  movedSecond = false;
  memberReadFails = false;
  accessVersion = 1;
  refreshedAsset = false;
  trashFails = false;
  permissionReadFails = false;
  vi.clearAllMocks();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("crew asset center", () => {
  it("shows used, total, remaining and reserved storage", async () => {
    await render();
    expect(document.body.textContent).toContain("2.00 GB used of 100.00 GB");
    expect(document.body.textContent).toContain("97.00 GB available");
    expect(document.body.textContent).toContain("1.00 GB reserved for uploads");
  });
  it("waits for every bulk move and lists failed files while reporting successes", async () => {
    bulkMove = true;
    await render();
    await click(
      document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!
    );
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select second.png"]')!);
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Move"]')!);
    const form = document.querySelector('[data-slot="dialog-content"] form')!;
    await vi.waitFor(() =>
      expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    );
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "concept.png: Name already exists"
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("1"));
    expect(
      requests.filter((r) => r.method === "GET" && r.url.includes("/assets?")).length
    ).toBeGreaterThan(1);
  });

  it("loads real asset data and opens a file in the right preview region", async () => {
    await render();

    const row = byText("span", "concept.png").closest<HTMLElement>('[role="button"]');
    if (!row) throw new Error("Asset row not found");
    await click(row);

    const preview = document.querySelector<HTMLElement>(
      'aside[aria-label="Asset preview and details"]'
    );
    expect(preview?.textContent).toContain("concept.png");
    expect(preview?.textContent).toContain("Lin Mo");
    expect(preview?.querySelector('img[alt="concept.png"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("opens a chat attachment deeplink directly in the asset inspector", async () => {
    await render("file-1");

    expect(requests.some((request) => request.url.endsWith("/assets/nodes/file-1"))).toBe(true);
    await act(async () => {
      await vi.waitFor(() => {
        const preview = document.querySelector<HTMLElement>(
          'aside[aria-label="Asset preview and details"]'
        );
        expect(preview?.textContent).toContain("concept.png");
      });
    });
  });

  it("opens a workbench folder link inside that folder", async () => {
    await render("folder-1");
    await act(async () => {
      await vi.waitFor(() =>
        expect(requests.some((request) => request.url.includes("parentId=folder-1"))).toBe(true)
      );
    });
    expect(document.querySelector('aside[aria-label="Asset preview and details"]')).toBeNull();
  });

  it("opens folders in place and updates the API parent scope", async () => {
    await render();

    const row = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find((row) =>
      row.textContent?.includes("Storyboard")
    );
    if (!row) throw new Error("Folder row not found");
    await act(async () => {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(requests.some((request) => request.url.includes("parentId=folder-1"))).toBe(true);
    expect(document.body.textContent).toContain("Storyboard");
  });

  it("creates a folder inside the current directory", async () => {
    await render();
    await click(byText("button", "New folder"));

    const input = document.querySelector<HTMLInputElement>('input[placeholder="Folder name"]');
    if (!input) throw new Error("Folder name input not found");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "References");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = input.closest("form");
    if (!form) throw new Error("Folder form not found");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const createRequest = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/assets/folders")
    );
    expect(createRequest?.body).toEqual({ name: "References", parentId: null });
  });

  it("queries the favorites source instead of filtering stale local mocks", async () => {
    await render();
    await click(byText("button", "Favorites"));

    expect(requests.some((request) => request.url.includes("source=favorites"))).toBe(true);
  });

  it("keeps move versions through refresh and retry until the dialog is reopened", async () => {
    const client = await render();
    await click(
      document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!
    );
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Move"]')!);
    refreshedAsset = true;
    await act(async () => {
      await client.invalidateQueries();
    });
    const submit = async () => {
      await act(async () => {
        document
          .querySelector('[data-slot="dialog-content"] form')!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    };
    await submit();
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toMatchObject({
      expectedUpdatedAt: ROOT_ITEMS[1].updatedAt,
    });
    await submit();
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toMatchObject({
      expectedUpdatedAt: ROOT_ITEMS[1].updatedAt,
    });
    await click(byText("button", "Cancel"));
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Move"]')!);
    await submit();
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toMatchObject({
      expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
    });
  });

  it("locks rename to the single checked asset instead of the open inspector asset", async () => {
    await render();

    const fileRow = byText("span", "concept.png").closest<HTMLElement>('[role="button"]');
    if (!fileRow) throw new Error("File row not found");
    await click(fileRow);

    const folderCheckbox = document.querySelector<HTMLInputElement>(
      'input[aria-label="Select Storyboard"]'
    );
    if (!folderCheckbox) throw new Error("Folder checkbox not found");
    await act(async () => {
      folderCheckbox.click();
    });

    const rename = document.querySelector<HTMLButtonElement>('button[aria-label="Rename"]');
    if (!rename) throw new Error("Rename action not found");
    await click(rename);

    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="Name"]');
    expect(nameInput?.value).toBe("Storyboard");
  });

  it("disables upload when the region storage provider is unavailable", async () => {
    storageAvailable = false;
    await render();

    const upload = byText("button", "Upload") as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    expect(document.body.textContent).toContain("Cloudflare R2");
    expect(document.body.textContent).toContain("Storage not configured");
  });

  it("persists a restricted asset permission boundary from the inspector", async () => {
    await render();

    const row = byText("span", "concept.png").closest<HTMLElement>('[role="button"]');
    if (!row) throw new Error("Asset row not found");
    await click(row);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await click(byText("button", "Manage access"));

    const restricted = document.querySelector<HTMLInputElement>(
      'aside[aria-label="Asset preview and details"] input[type="checkbox"]'
    );
    if (!restricted) throw new Error("Restricted access checkbox not found");
    await act(async () => restricted.click());
    await click(byText("button", "Save access"));

    const request = requests.find(
      (candidate) =>
        candidate.method === "PUT" && candidate.url.endsWith("/assets/file-1/permissions")
    );
    expect(request?.body).toEqual({
      accessMode: "restricted",
      expectedVersion: 1,
      grants: [],
    });
  });

  it("locks the permission draft while saving and retains it after failure", async () => {
    await render();
    const originalFetch = globalThis.fetch;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/assets/file-1/permissions") && init?.method === "PUT") {
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return originalFetch(input, init);
    });
    await click(byText("span", "concept.png").closest<HTMLElement>('[role="button"]')!);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await click(byText("button", "Manage access"));
    const restricted = document.querySelector<HTMLInputElement>(
      'aside[aria-label="Asset preview and details"] input[type="checkbox"]'
    )!;
    await click(restricted);
    await click(byText("button", "Save access"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(restricted.disabled).toBe(true);
    expect((byText("button", "Cancel") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(jsonResponse({ message: "Save unavailable" }, { status: 503 })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(restricted.disabled).toBe(false);
    expect(restricted.checked).toBe(true);
    expect((byText("button", "Cancel") as HTMLButtonElement).disabled).toBe(false);
    expect(byText("button", "Save access")).toBeTruthy();
  });

  it("requires confirmation before permanent deletion from Trash", async () => {
    await render();
    await click(byText("button", "Trash"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const checkbox = document.querySelector<HTMLInputElement>(
      'input[aria-label="Select concept.png"]'
    );
    if (!checkbox) throw new Error("Asset checkbox not found");
    await act(async () => {
      checkbox.click();
    });
    await click(byText("button", "Delete forever"));

    expect(document.body.textContent).toContain("Permanently delete selected assets?");
    expect(
      requests.some((request) => request.method === "DELETE" && request.url.endsWith("/permanent"))
    ).toBe(false);
  });
});

describe("Link workspace", () => {
  it("links a workspace from the shared header and updates the trigger", async () => {
    const client = await render();
    const sourceKey = ["crew", "assets", "crew_1", "studio-media-options", {}, "user-1"];
    const otherAccount = [...sourceKey.slice(0, -1), "other-user"];
    const otherCrew = ["crew", "assets", "crew_2", "studio-media-options", {}, "user-1"];
    for (const key of [sourceKey, otherAccount, otherCrew]) {
      client.setQueryData(key, { workspaceId: "old-workspace", projects: [], items: [] });
    }
    const trigger = byText("button", "Link workspace");
    const header = document.querySelector('header[aria-label="Crew header"]');
    expect(header?.contains(trigger)).toBe(true);
    expect(header?.contains(byText("button", "New folder"))).toBe(false);
    expect(
      [...document.querySelectorAll("button")].filter(
        (button) => button.textContent === "Link workspace"
      )
    ).toHaveLength(1);
    await click(trigger);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await click(byText("span", "Studio"));
    expect(requests).toContainEqual(
      expect.objectContaining({ method: "PATCH", body: { workspaceId: "ws-1" } })
    );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(byText("button", "Studio")?.textContent).toBe("Studio");
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Open in Studio");
    expect(client.getQueryState(sourceKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherAccount)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherCrew)?.isInvalidated).toBe(false);
  });
  it("keeps the action disabled without the workspace-link capability", async () => {
    canLink = false;
    await render();
    expect((byText("button", "Link workspace") as HTMLButtonElement).disabled).toBe(true);
    expect(requests.some((r) => r.url.endsWith("/studio-workspace-options"))).toBe(false);
  });
  it("keeps the picker open and reports a rejected link", async () => {
    linkFails = true;
    const client = await render();
    const sourceKey = ["crew", "assets", "crew_1", "studio-media-options", {}, "user-1"];
    client.setQueryData(sourceKey, { workspaceId: "old-workspace", projects: [], items: [] });
    await click(byText("button", "Link workspace"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await click(byText("span", "Studio"));
    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Workspace link changed"
      );
    });
    expect(byText("span", "Studio")).toBeTruthy();
    expect(client.getQueryState(sourceKey)?.isInvalidated).toBe(false);
  });
});

it("retains assets and pauses scrolling after a next-page failure, then retries that page", async () => {
  paginated = true;
  nextPageFails = true;
  await render();
  const scroller = container!.querySelector<HTMLElement>(".relative.overflow-auto")!;
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(document.body.textContent).toContain("Next page unavailable");
  const count = requests.filter((request) => request.url.includes("cursor=")).length;
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(requests.filter((request) => request.url.includes("cursor="))).toHaveLength(count);
  expect(document.body.textContent).toContain("concept.png");
  nextPageFails = false;
  await click(byText("button", "Retry"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(document.body.textContent).toContain("last.png");
  expect(requests.filter((request) => request.url.includes("cursor="))).toHaveLength(count + 1);
});

it("retains loaded assets after a refresh failure and recovers with refresh retry", async () => {
  const client = await render();
  assetListFails = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["crew", "assets", "crew_1", "list"] });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(document.body.textContent).toContain("Refresh unavailable");
  expect(document.body.textContent).toContain("concept.png");
  assetListFails = false;
  await click(byText("button", "Retry"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(document.body.textContent).not.toContain("Refresh unavailable");
  expect(document.body.textContent).toContain("concept.png");
});

describe("Legacy project link", () => {
  it("shows the retained project and explains explicit workspace replacement", async () => {
    legacyProject = { id: "old-project", name: "Old canvas" };
    await render();
    await click(byText("button", "Project: Old canvas"));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Existing Crew asset access stays limited")
    );
    expect(document.body.textContent).toContain("Disconnect project");
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    await click(byText("span", "Studio"));
    await vi.waitFor(() => expect(byText("button", "Studio")).toBeTruthy());
    expect(document.body.textContent).not.toContain("Project: Old canvas");
  });
  it("allows explicit legacy disconnect without choosing a workspace", async () => {
    legacyProject = { id: "old-project", name: "Old canvas" };
    const client = await render();
    const sourceKey = ["crew", "assets", "crew_1", "studio-media-options", {}, "user-1"];
    client.setQueryData(sourceKey, { workspaceId: "old-workspace", projects: [], items: [] });
    await click(byText("button", "Project: Old canvas"));
    await vi.waitFor(() => expect(byText('[role="option"]', "Disconnect project")).toBeTruthy());
    await click(byText('[role="option"]', "Disconnect project"));
    expect(requests).toContainEqual(
      expect.objectContaining({ method: "PATCH", body: { workspaceId: null } })
    );
    await vi.waitFor(() => expect(byText("button", "Link workspace")).toBeTruthy());
    expect(client.getQueryState(sourceKey)?.isInvalidated).toBe(true);
  });
  it("keeps a legacy link visible but disabled for non-admins", async () => {
    legacyProject = { id: "old-project", name: "Old canvas" };
    canLink = false;
    await render();
    expect((byText("button", "Project: Old canvas") as HTMLButtonElement).disabled).toBe(true);
    expect(requests.some((r) => r.url.endsWith("/studio-workspace-options"))).toBe(false);
  });
});

it("keeps the original permission version through refresh and reloads it on reopening", async () => {
  const client = await render();
  await click(byText("span", "concept.png").closest<HTMLElement>('[role="button"]')!);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await click(byText("button", "Manage access"));
  const checkbox = document.querySelector<HTMLInputElement>(
    'aside[aria-label="Asset preview and details"] input[type="checkbox"]'
  )!;
  await click(checkbox);
  accessVersion = 2;
  await act(async () => {
    await client.invalidateQueries();
  });
  expect(checkbox.checked).toBe(true);
  await click(byText("button", "Save access"));
  const writes = () =>
    requests.filter((r) => r.method === "PUT" && r.url.endsWith("/assets/file-1/permissions"));
  expect(writes()[0]?.body).toMatchObject({ expectedVersion: 1, accessMode: "restricted" });
  await click(byText("button", "Manage access"));
  await click(byText("button", "Save access"));
  expect(writes()[1]?.body).toMatchObject({ expectedVersion: 2 });
});

it("rebuilds asset pages after a cursor rejection instead of replaying the invalid boundary", async () => {
  paginated = true;
  cursorRejected = true;
  await render();
  const scroller = container!.querySelector<HTMLElement>(".relative.overflow-auto")!;
  await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Restart assets"));
  expect(document.body.textContent).toContain("concept.png");
  const before = requests.length;
  paginated = false;
  await click(byText("button", "Retry"));
  await vi.waitFor(() => expect(requests.length).toBeGreaterThan(before));
  const retried = requests.slice(before).find((request) => request.url.includes("/assets?"))!;
  expect(retried.url).not.toContain("cursor=");
  await vi.waitFor(() => expect(document.body.textContent).not.toContain("Restart assets"));
});

it("retries failed access reads without closing the asset preview", async () => {
  permissionReadFails = true;
  await render();
  await click(byText("span", "concept.png").closest<HTMLElement>('[role="button"]')!);
  await vi.waitFor(() => expect(document.body.textContent).toContain("Access read unavailable"));
  const panel = document.querySelector('aside[aria-label="Asset preview and details"]')!;
  const retry = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Retry"
  );
  expect(retry).toBeDefined();
  permissionReadFails = false;
  await click(retry!);
  await vi.waitFor(() => expect(panel.textContent).toContain("Manage access"));
  expect(panel.textContent).not.toContain("Access read unavailable");
  expect(panel.textContent).toContain("concept.png");
});

it("blocks duplicate folder creation and retains a failed draft for retry", async () => {
  await render();
  const original = globalThis.fetch;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const create = vi.fn(() => pending);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST" && String(input).endsWith("/assets/folders")
      ? create()
      : original(input, init)
  );
  await click(byText("button", "New folder"));
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Folder name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "References"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = input.closest("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(input.disabled).toBe(true);
  await act(async () => finish(jsonResponse({ message: "Create unavailable" }, { status: 503 })));
  expect(input.value).toBe("References");
  expect(input.disabled).toBe(false);
  vi.stubGlobal("fetch", original);
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(document.querySelector('input[placeholder="Folder name"]')).toBeNull();
});

it("blocks restricted-access saves and retries a failed member list", async () => {
  memberReadFails = true;
  await render();
  await click(byText("span", "concept.png").closest<HTMLElement>('[role="button"]')!);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await click(byText("button", "Manage access"));
  await click(
    document.querySelector<HTMLInputElement>(
      'aside[aria-label="Asset preview and details"] input[type="checkbox"]'
    )!
  );
  expect((byText("button", "Save access") as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).toContain("Member list unavailable");
  memberReadFails = false;
  await click(byText("button", "Retry"));
  await vi.waitFor(() =>
    expect((byText("button", "Save access") as HTMLButtonElement).disabled).toBe(false)
  );
  expect(document.body.textContent).not.toContain("Member list unavailable");
  expect(requests.some((r) => r.method === "PUT")).toBe(false);
});

it("shows destination read failure and retries before allowing a move", async () => {
  folderReadFails = true;
  await render();
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!);
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Move"]')!);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="dialog-content"]')?.textContent).toContain(
      "Folders unavailable"
    )
  );
  const form = document.querySelector('[data-slot="dialog-content"] form')!;
  expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  folderReadFails = false;
  await click(byText("button", "Retry"));
  await vi.waitFor(() =>
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  );
  expect(form.textContent).not.toContain("Folders unavailable");
});

it("keeps the original rename version when assets refresh during editing", async () => {
  const client = await render();
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!);
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "My draft.png"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  refreshedAsset = true;
  await act(async () => {
    await client.invalidateQueries();
  });
  expect(input.value).toBe("My draft.png");
  await act(async () => {
    document
      .querySelector('[data-slot="dialog-content"] form')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const update = requests.find((r) => r.method === "PATCH" && r.url.endsWith("/assets/file-1"));
  expect(update?.body).toMatchObject({
    name: "My draft.png",
    expectedUpdatedAt: ROOT_ITEMS[1].updatedAt,
  });
  await click(byText("button", "Cancel"));
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe(
    "Collaborator.png"
  );
  await act(async () => {
    document
      .querySelector('[data-slot="dialog-content"] form')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(
    requests.filter((r) => r.method === "PATCH" && r.url.endsWith("/assets/file-1")).at(-1)?.body
  ).toMatchObject({
    expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
  });
});

it.each(["trash", "restore"])(
  "retries only failed assets after partial bulk %s",
  async (action) => {
    const suffix = action === "restore" ? "/restore" : "";
    const method = action === "restore" ? "POST" : "DELETE";
    const label = action === "restore" ? "Restore" : "Delete";
    trashFails = true;
    await render();
    if (action === "restore") {
      await click(byText("button", "Trash"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await act(async () => {
      document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!.click();
      document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!.click();
    });
    await click(byText("button", label));
    expect(document.body.textContent).toContain("1 selected");
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!.checked
    ).toBe(false);
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!.checked
    ).toBe(true);
    trashFails = false;
    await click(byText("button", label));
    expect(
      requests.filter((r) => r.method === method && r.url.endsWith(`/assets/folder-1${suffix}`))
    ).toHaveLength(1);
    expect(
      requests.filter((r) => r.method === method && r.url.endsWith(`/assets/file-1${suffix}`))
    ).toHaveLength(2);
  }
);

it("clears checked assets when the search changes", async () => {
  await render();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!.click()
  );
  const search = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')!;
  expect(search).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "concept"
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')?.checked
  ).not.toBe(true);
  expect(document.body.textContent).not.toContain("1 selected");
});

it("clears checked assets when the type filter hides them", async () => {
  await render();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!.click()
  );
  const filter = document.querySelector<HTMLElement>('[aria-label="Filter by type"]')!;
  await act(async () =>
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === "Video"
  )!;
  expect(option).toBeDefined();
  await click(option);
  expect(document.body.textContent).not.toContain("1 selected");
});

it.each(["trash", "restore"])("prevents duplicate bulk %s while pending", async (action) => {
  await render();
  if (action === "restore") {
    await click(byText("button", "Trash"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!);
  const originalFetch = globalThis.fetch;
  const finishes: Array<() => void> = [];
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const matches =
        action === "trash"
          ? init?.method === "DELETE" && String(input).endsWith("/assets/file-1")
          : init?.method === "POST" && String(input).endsWith("/assets/file-1/restore");
      if (!matches) return originalFetch(input, init);
      attempts += 1;
      return new Promise<Response>((resolve) => {
        finishes.push(() =>
          resolve(action === "trash" ? new Response(null, { status: 204 }) : jsonResponse({}))
        );
      });
    })
  );
  try {
    const button = byText("button", action === "trash" ? "Delete" : "Restore") as HTMLButtonElement;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(attempts).toBe(1);
    expect(button.disabled).toBe(true);
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!);
  } finally {
    await act(async () => {
      finishes.forEach((finish) => finish());
    });
  }
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!.checked
  ).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!.checked
  ).toBe(false);
});

it.each(["trash", "restore"])(
  "keeps a different preview opened while bulk %s is pending",
  async (action) => {
    await render();
    if (action === "restore") {
      await click(byText("button", "Trash"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!);
    const originalFetch = globalThis.fetch;
    let finish!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const matches =
          action === "trash"
            ? init?.method === "DELETE" && String(input).endsWith("/assets/folder-1")
            : init?.method === "POST" && String(input).endsWith("/assets/folder-1/restore");
        if (!matches) return originalFetch(input, init);
        return new Promise<Response>((resolve) => {
          finish = () =>
            resolve(action === "trash" ? new Response(null, { status: 204 }) : jsonResponse({}));
        });
      })
    );
    await click(byText("button", action === "trash" ? "Delete" : "Restore"));
    const row = byText("span", "concept.png").closest<HTMLElement>('[role="button"]')!;
    await click(row);
    const preview = () => document.querySelector('aside[aria-label="Asset preview and details"]');
    expect(preview()?.textContent).toContain("concept.png");
    await act(async () => {
      finish();
    });
    expect(preview()?.textContent).toContain("concept.png");
  }
);

it("disables cached workspace authority after an overview refresh fails", async () => {
  const client = await render();
  expect((byText("button", "Link workspace") as HTMLButtonElement).disabled).toBe(false);
  const key = ["crew", "production", "crew_1", "overview", "user-1"];
  client.setQueryDefaults(key, { retry: false });
  overviewReadFails = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: key });
  });
  await vi.waitFor(() =>
    expect((byText("button", "Link workspace") as HTMLButtonElement).disabled).toBe(true)
  );
  overviewReadFails = false;
  await act(async () => {
    await client.refetchQueries({ queryKey: key });
  });
  await vi.waitFor(() =>
    expect((byText("button", "Link workspace") as HTMLButtonElement).disabled).toBe(false)
  );
});

function assetRow(name: string) {
  const row = document
    .querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`)
    ?.closest<HTMLElement>('[role="button"]');
  if (!row) throw new Error(`Missing asset row: ${name}`);
  return row;
}
function dragEvent(target: HTMLElement, type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { effectAllowed: "", dropEffect: "", setData: vi.fn() },
  });
  target.dispatchEvent(event);
  return event;
}
it.each(["List view", "Card view"])("moves a dragged file into a folder in %s", async (view) => {
  bulkMove = true;
  await render();
  if (view === "Card view")
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Card view"]')!);
  const source = assetRow("second.png"),
    folder = assetRow("Storyboard");
  expect(source.draggable).toBe(true);
  await act(async () => {
    dragEvent(source, "dragstart");
    dragEvent(folder, "dragover");
  });
  expect(folder.className).toContain("ring-primary");
  await act(async () => {
    dragEvent(folder, "drop");
    dragEvent(folder, "drop");
  });
  await vi.waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
  expect(requests.find((r) => r.method === "PATCH")?.body).toMatchObject({
    parentId: "folder-1",
    expectedUpdatedAt: ROOT_ITEMS[1].updatedAt,
  });
  expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
});
it("moves selected files together and keeps only failures for retry", async () => {
  bulkMove = true;
  await render();
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!);
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select second.png"]')!);
  await act(async () => {
    dragEvent(assetRow("second.png"), "dragstart");
    dragEvent(assetRow("Storyboard"), "drop");
  });
  await vi.waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "concept.png: Name already exists"
    )
  );
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("1"));
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')?.checked
  ).toBe(true);
});
it("ignores external drops and files used as drop targets", async () => {
  await render();
  await act(async () => {
    dragEvent(assetRow("Storyboard"), "drop");
  });
  await act(async () => {
    dragEvent(assetRow("concept.png"), "dragstart");
    dragEvent(assetRow("concept.png"), "drop");
  });
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
});
it("rejects a drag selection containing the destination folder", async () => {
  await render();
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!);
  await click(document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!);
  await act(async () => {
    expect(dragEvent(assetRow("concept.png"), "dragstart").defaultPrevented).toBe(true);
    dragEvent(assetRow("Storyboard"), "drop");
  });
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
});

it("does not enable dragging without organization permission", async () => {
  allowOrganize = false;
  await render();
  expect(assetRow("concept.png").draggable).toBe(false);
  await act(async () => {
    expect(dragEvent(assetRow("concept.png"), "dragstart").defaultPrevented).toBe(true);
    dragEvent(assetRow("Storyboard"), "drop");
  });
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
});

it.each(["folder", "file"])("rejects moving with view-only %s access", async (kind) => {
  if (kind === "folder") folderPermission = "view";
  else filePermission = "view";
  await render();
  await act(async () => {
    dragEvent(assetRow("concept.png"), "dragstart");
    dragEvent(assetRow("Storyboard"), "drop");
  });
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
});
it("accepts a folder with upload permission, matching the existing Move contract", async () => {
  folderPermission = "upload";
  bulkMove = true;
  await render();
  await act(async () => {
    dragEvent(assetRow("second.png"), "dragstart");
    dragEvent(assetRow("Storyboard"), "drop");
  });
  await vi.waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
});
it.each([false, true])(
  "preserves new selection and preview while a move settles (partial failure: %s)",
  async (partial) => {
    bulkMove = true;
    await render();
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select second.png"]')!);
    if (partial)
      await click(
        document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!
      );
    const originalFetch = globalThis.fetch;
    let finish!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PATCH" || !String(input).endsWith("/assets/file-2"))
          return originalFetch(input, init);
        return new Promise<Response>((resolve) => {
          finish = () => resolve(originalFetch(input, init));
        });
      })
    );
    await act(async () => {
      dragEvent(assetRow("second.png"), "dragstart");
      dragEvent(assetRow("Storyboard"), "drop");
    });
    await click(document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!);
    await click(assetRow("concept.png"));
    const preview = () => document.querySelector('aside[aria-label="Asset preview and details"]');
    expect(preview()?.textContent).toContain("concept.png");
    await act(async () => finish());
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("1"))
    );
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Select Storyboard"]')!.checked
    ).toBe(true);
    expect(preview()?.textContent).toContain("concept.png");
    if (partial) {
      expect(
        document.querySelector<HTMLInputElement>('input[aria-label="Select concept.png"]')!.checked
      ).toBe(true);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "concept.png: Name already exists"
      );
    }
  }
);

it("expands and collapses nested folders without navigating until selected", async () => {
  await render();
  const rail = document.querySelector("aside")!;
  const toggle = rail.querySelector<HTMLButtonElement>('button[aria-label="Storyboard"]')!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(rail.textContent).not.toContain("Subtitled");
  await click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(rail.textContent).toContain("Subtitled");
  expect(requests.some((r) => r.url.includes("parentId=nested-folder"))).toBe(false);
  await click(
    [...rail.querySelectorAll("button")].find((button) => button.textContent === "Subtitled")!
  );
  await vi.waitFor(() =>
    expect(requests.some((r) => r.url.includes("parentId=nested-folder"))).toBe(true)
  );
  await click(toggle);
  expect(rail.textContent).not.toContain("Subtitled");
});

it("marks attached contracts read-only and removes unavailable edit actions", async () => {
  contractLocked = true;
  await render();
  const checkbox = document.querySelector<HTMLInputElement>(
    'input[aria-label="Select concept.png"]'
  )!;
  await act(async () => checkbox.click());
  expect(document.body.textContent).toContain("Contract · Read-only");
  for (const label of ["Rename", "Move", "Move to trash"]) {
    expect(document.querySelector(`button[aria-label="${label}"]`)).toBeNull();
  }
});
