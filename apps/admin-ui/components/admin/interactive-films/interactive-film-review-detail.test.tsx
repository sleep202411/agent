// @vitest-environment jsdom
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { InteractiveFilmReviewDetail } from "./interactive-film-review-detail";
import type { AdminInteractiveFilmDetail } from "@/lib/interactive-film-admin-contract";
import {
  parseAdminInteractiveFilmListingSnapshot,
  type AdminInteractiveFilmListingSnapshot,
} from "@/lib/interactive-film-listing-contract";

const { request, listingRequest, refresh } = vi.hoisted(() => ({
  request: vi.fn(),
  listingRequest: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  requestAdminInteractiveFilm: request,
}));
vi.mock("@/lib/interactive-film-listing-client", () => ({
  requestAdminInteractiveFilmListing: listingRequest,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    onConfirm,
    confirmLabel,
    trigger,
  }: {
    onConfirm: () => Promise<void>;
    confirmLabel: string;
    trigger: ReactElement<{ disabled?: boolean }>;
  }) => (
    <button disabled={trigger.props.disabled} onClick={() => void onConfirm()}>
      {confirmLabel}
    </button>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) =>
    asChild ? (
      children
    ) : (
      <button {...props} data-variant={variant} data-size={size}>
        {children}
      </button>
    ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const game: AdminInteractiveFilmDetail = {
  gameId: "10000000-0000-4000-8000-000000000001",
  title: "Fixture film",
  subtitle: null,
  coverUrl: "https://example.com/cover.png",
  status: "reviewing",
  draftVersion: "release.1",
  currentVersion: null,
  updatedAt: null,
  creatorId: "15",
  rejectReason: null,
  draftManifestUrl: "https://example.com/manifest.json",
  manifestUrl: null,
  createdAt: null,
  publishedAt: null,
  offlineAt: null,
};
const materials: AdminInteractiveFilmListingSnapshot = {
  contentVersion: "release.1",
  listing: null,
};
const snapshot: AdminInteractiveFilmListingSnapshot = {
  contentVersion: "release.1",
  listing: {
    gameId: game.gameId,
    title: game.title,
    defaultLocale: "en-US",
    description: "Frozen introduction",
    developer: "",
    tags: [],
    coverUrl: game.coverUrl,
    coverStatus: "available",
    trailerUrl: null,
    screenshots: [],
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function detail(initialMaterials = materials) {
  return (
    <InteractiveFilmReviewDetail
      siteLabel="Global"
      databaseLabel="Fixture"
      gameId={game.gameId}
      initialGame={game}
      initialError={null}
      initialListing={{ contentVersion: "release.1", data: initialMaterials, error: null }}
      playback={null}
    />
  );
}
async function render(view: ReactNode = detail(), session = "alice") {
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
async function approve() {
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "通过并发布")!
      .click()
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
});

it.each(["leave", "switch account"])(
  "does not approve after the administrator chooses to %s during preflight",
  async (change) => {
    const pending = deferred<AdminInteractiveFilmDetail>();
    request
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ...game, status: "published" });
    listingRequest.mockResolvedValue(materials);
    await render();
    await approve();
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    await render(
      change === "leave" ? <div>Queue</div> : detail(),
      change === "leave" ? "alice" : "bob"
    );
    await act(async () => pending.resolve(game));
    expect(request.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
    expect(listingRequest).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  }
);

it("checks the frozen version before issuing exactly one approval", async () => {
  request
    .mockResolvedValueOnce(game)
    .mockResolvedValue({ ...game, status: "published", currentVersion: "release.1" });
  listingRequest.mockResolvedValue(materials);
  await render();
  await act(async () => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "通过并发布"
    )!;
    button.click();
    button.click();
  });
  expect(request.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  expect(listingRequest).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("does not approve a changed candidate version", async () => {
  request.mockResolvedValue({ ...game, draftVersion: "release.2" });
  listingRequest.mockResolvedValue({ contentVersion: "release.2", listing: null });
  await render();
  await approve();
  expect(request.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  expect(listingRequest).toHaveBeenCalledTimes(1);
  expect(listingRequest.mock.calls[0]?.[1]).toBe("release.2");
  expect(container.textContent).toContain("The submitted version has changed");
});

it("blocks approval until the frozen cover loads and disables it on media failure", async () => {
  await render(detail(snapshot));
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "通过并发布"
  )!;
  expect(button.disabled).toBe(true);
  const cover = container.querySelector('img[alt="Fixture film cover"]')!;
  await act(async () => {
    cover.dispatchEvent(new Event("load"));
  });
  expect(button.disabled).toBe(false);
  await act(async () => {
    cover.dispatchEvent(new Event("error"));
  });
  expect(button.disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("allows approval of an empty introduction after the frozen cover loads and preflight passes", async () => {
  const response = {
    ...snapshot,
    listing: { ...snapshot.listing!, description: "" },
  };
  const parseMaterials = () =>
    parseAdminInteractiveFilmListingSnapshot(response, game.gameId, game.draftVersion!);
  request
    .mockResolvedValueOnce(game)
    .mockResolvedValue({ ...game, status: "published", currentVersion: game.draftVersion });
  listingRequest.mockImplementation(async () => parseMaterials());
  await render(detail(parseMaterials()));
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "通过并发布"
  )!;
  expect(container.textContent).toContain("No introduction provided.");
  expect(button.disabled).toBe(true);
  await act(async () => {
    container.querySelector('img[alt="Fixture film cover"]')!.dispatchEvent(new Event("load"));
  });
  expect(button.disabled).toBe(false);
  await approve();
  const posts = request.mock.calls.filter(([, init]) => init.method === "POST");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]![1].body)).toEqual({ action: "approve" });
  expect(listingRequest).toHaveBeenCalledWith(
    game.gameId,
    game.draftVersion,
    expect.any(AbortSignal)
  );
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("approves a release without optional cover or text after checking the exact version", async () => {
  const response = {
    ...snapshot,
    listing: {
      ...snapshot.listing!,
      description: "",
      coverUrl: null,
      coverStatus: "not_provided",
    },
  };
  const parseMaterials = () =>
    parseAdminInteractiveFilmListingSnapshot(response, game.gameId, game.draftVersion!);
  request
    .mockResolvedValueOnce(game)
    .mockResolvedValue({ ...game, status: "published", currentVersion: game.draftVersion });
  listingRequest.mockImplementation(async () => parseMaterials());
  await render(detail(parseMaterials()));
  expect(container.textContent).toContain("No cover provided.");
  await approve();
  const posts = request.mock.calls.filter(([, init]) => init.method === "POST");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]![1].body)).toEqual({ action: "approve" });
  expect(listingRequest).toHaveBeenCalledWith(
    game.gameId,
    game.draftVersion,
    expect.any(AbortSignal)
  );
});

it("does not approve when a selected cover becomes unavailable during preflight", async () => {
  request.mockResolvedValue(game);
  listingRequest.mockResolvedValue({
    ...snapshot,
    listing: { ...snapshot.listing!, coverUrl: null, coverStatus: "unavailable" },
  });
  await render(detail(snapshot));
  await act(async () => {
    container.querySelector('img[alt="Fixture film cover"]')!.dispatchEvent(new Event("load"));
  });
  await approve();
  expect(request.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  expect(container.textContent).toContain("cannot be approved because its cover is unavailable");
});

it("does not approve a coverless submission when the candidate changes during preflight", async () => {
  const coverless = {
    ...snapshot,
    listing: { ...snapshot.listing!, coverUrl: null, coverStatus: "not_provided" as const },
  };
  request.mockResolvedValue({ ...game, draftVersion: "release.2" });
  listingRequest.mockResolvedValue({ ...coverless, contentVersion: "release.2" });
  await render(detail(coverless));
  await approve();
  expect(request.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  expect(container.textContent).toContain("The submitted version has changed");
});

it("does not post approval if the loaded cover fails while materials preflight is pending", async () => {
  const pending = deferred<AdminInteractiveFilmListingSnapshot>();
  request.mockResolvedValue(game);
  listingRequest.mockReturnValueOnce(pending.promise);
  await render(detail(snapshot));
  const cover = container.querySelector('img[alt="Fixture film cover"]')!;
  await act(async () => {
    cover.dispatchEvent(new Event("load"));
  });
  await approve();
  expect(listingRequest).toHaveBeenCalledTimes(1);
  await act(async () => {
    cover.dispatchEvent(new Event("error"));
  });
  await act(async () => pending.resolve(snapshot));
  expect(request.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  expect(refresh).not.toHaveBeenCalled();
});
