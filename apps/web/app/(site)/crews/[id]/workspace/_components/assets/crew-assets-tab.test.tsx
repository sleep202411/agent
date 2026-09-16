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
let linkFails = false;
let linkedWorkspaceId: string | null = null;
let bulkMove = false;
let movedSecond = false;

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
        return jsonResponse({
          studioProject: legacyProject,
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
            organize: true,
            trash: true,
            restore: true,
            deleteForever: true,
          },
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
        return jsonResponse({
          accessMode: "inherit",
          permissionVersion: 1,
          effectivePermission: "manage",
          canManage: true,
          grants: [],
        });
      }
      if (method === "GET" && url.endsWith("/members")) {
        return jsonResponse([]);
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
      if (method === "GET" && url.endsWith("/assets/folders")) return jsonResponse([ROOT_ITEMS[0]]);
      if (method === "GET" && url.includes("/assets")) {
        if (assetListFails)
          return jsonResponse({ message: "Refresh unavailable" }, { status: 503 });
        if (url.includes("cursor=")) {
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
                ...ROOT_ITEMS,
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
      if (method === "PUT" || method === "POST") return jsonResponse({ favorite: true });
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
  assetListFails = false;
  canLink = true;
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
  bulkMove = false;
  movedSecond = false;
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

  it("opens folders in place and updates the API parent scope", async () => {
    await render();

    const row = byText("span", "Storyboard").closest<HTMLElement>('[role="button"]');
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
    await render();
    const trigger = byText("button", "Link workspace");
    const header = document.querySelector('header[aria-label="Crew header"]');
    expect(header?.contains(trigger)).toBe(true);
    expect(header?.contains(byText("button", "New folder"))).toBe(false);
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
      expect(trigger.textContent).toBe("Studio");
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Open in Studio");
  });
  it("keeps the action disabled without the workspace-link capability", async () => {
    canLink = false;
    await render();
    expect((byText("button", "Link workspace") as HTMLButtonElement).disabled).toBe(true);
    expect(requests.some((r) => r.url.endsWith("/studio-workspace-options"))).toBe(false);
  });
  it("keeps the picker open and reports a rejected link", async () => {
    linkFails = true;
    await render();
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
    await render();
    await click(byText("button", "Project: Old canvas"));
    await vi.waitFor(() => expect(byText('[role="option"]', "Disconnect project")).toBeTruthy());
    await click(byText('[role="option"]', "Disconnect project"));
    expect(requests).toContainEqual(
      expect.objectContaining({ method: "PATCH", body: { workspaceId: null } })
    );
    await vi.waitFor(() => expect(byText("button", "Link workspace")).toBeTruthy());
  });
  it("keeps a legacy link visible but disabled for non-admins", async () => {
    legacyProject = { id: "old-project", name: "Old canvas" };
    canLink = false;
    await render();
    expect((byText("button", "Project: Old canvas") as HTMLButtonElement).disabled).toBe(true);
    expect(requests.some((r) => r.url.endsWith("/studio-workspace-options"))).toBe(false);
  });
});
