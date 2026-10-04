// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetSummary, StoryCandidateAsset } from "@/lib/story-projects-api";
import type { StoryPublicationDraft } from "../_lib/story-publication-draft";
import { migratePublicationDraft } from "../_lib/story-publication-draft";
import type { StoryCandidateAssetPickerDialogProps } from "./project-canvas/story-candidate-asset-picker-dialog";
import type { StoryCandidateAssetsController } from "./project-canvas/use-story-candidate-assets";
import { StoryFilmDetailsEditor } from "./story-film-details-editor";

const COVER = "019f60f4-b101-70d4-8000-000000000011";
const FIRST = "019f60f4-b101-70d4-8000-000000000012";
const SECOND = "019f60f4-b101-70d4-8000-000000000013";
const VIDEO = "019f60f4-b101-70d4-8000-000000000014";
const BLOCKED = "019f60f4-b101-70d4-8000-000000000015";
const FAILED = "019f60f4-b101-70d4-8000-000000000016";
const h = vi.hoisted(() => ({ changed: vi.fn(), refresh: vi.fn(), image: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { index?: number }) =>
    values?.index ? `${key} ${values.index}` : key,
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => {
    h.image(src);
    // eslint-disable-next-line @next/next/no-img-element -- Expose image sources for media assertions.
    return <img src={src} alt={alt} />;
  },
}));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: vi.fn() }));
vi.mock("@/lib/story-projects-api", () => ({ addStoryCandidateAsset: vi.fn() }));
vi.mock("./project-canvas/story-candidate-asset-picker-dialog", () => ({
  StoryCandidateAssetPickerDialog: ({
    open,
    items,
    allowedKinds,
    canSelect,
    isSelectable,
    unavailableReason,
    onSelect,
  }: StoryCandidateAssetPickerDialogProps) =>
    open ? (
      <div data-slot="picker">
        {items
          .filter((item) => allowedKinds.includes(item.asset.kind as "image" | "video"))
          .map((item) => (
            <button
              key={item.asset.id}
              aria-label={`pick ${item.asset.id}`}
              disabled={!canSelect || (isSelectable ? !isSelectable(item) : false)}
              onClick={() => void onSelect(item)}
            >
              {item.asset.id}
              <span>{unavailableReason?.(item)}</span>
            </button>
          ))}
      </div>
    ) : null,
}));

let host: HTMLDivElement, root: Root, initial: StoryPublicationDraft, latest: StoryPublicationDraft;
let controller: StoryCandidateAssetsController, disabled: boolean, cover: MediaAssetSummary;

function Harness() {
  const [value, setValue] = useState(initial);
  return (
    <StoryFilmDetailsEditor
      projectId="project-one"
      value={value}
      cover={cover}
      candidates={controller}
      disabled={disabled}
      onChange={(next) => {
        latest = next;
        h.changed(next);
        setValue(next);
      }}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  disabled = false;
  cover = asset(COVER);
  initial = {
    coverAssetId: COVER,
    listing: {
      description: "A film\n\nChoose a path\n\nYour choices matter.",
      developer: "Crew",
      tags: [],
      trailerAssetId: VIDEO,
      screenshotAssetIds: [FIRST, SECOND],
    },
  };
  latest = initial;
  controller = {
    items: [
      cover,
      asset(FIRST, { moderationStatus: "unreviewed" }),
      asset(SECOND),
      asset(VIDEO, {
        kind: "video",
        contentType: "video/mp4",
        previewUrl: "https://media.example/trailer.mp4",
      }),
      asset(BLOCKED, { moderationStatus: "blocked" }),
      asset(FAILED, { status: "failed" }),
    ].map((media) => candidate(media)),
    refresh: h.refresh,
    canEdit: true,
    loading: false,
    failed: false,
    error: null,
    candidateIds: new Set(),
    pendingIds: new Set(),
    toggle: vi.fn(),
    remove: vi.fn(),
  };
  h.refresh.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

describe("film details editor", () => {
  it("shows legacy genres and tags together in the single tags field", async () => {
    const legacy = {
      ...initial,
      listing: { ...initial.listing, genres: ["Drama", "Mystery"], tags: ["Mystery", "Choices"] },
    };
    initial = migratePublicationDraft(legacy);
    await render();
    expect(initial.listing.tags).toEqual(["Drama", "Mystery", "Choices"]);
    expect(host.querySelector('input[placeholder="genresPlaceholder"]')).toBeNull();
    expect(host.querySelectorAll('input[placeholder="tagsPlaceholder"]')).toHaveLength(1);
    expect(host.textContent).toContain("Drama");
    expect(host.textContent).toContain("Mystery");
    expect(host.textContent).toContain("Choices");
  });

  it("uses one multiline introduction field and preserves section breaks", async () => {
    await render();
    const description = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="descriptionPlaceholder"]'
    )!;
    expect(description.value).toBe("A film\n\nChoose a path\n\nYour choices matter.");
    expect(description.maxLength).toBe(13_000);
    expect(description.disabled).toBe(false);
    expect(host.querySelectorAll("textarea")).toHaveLength(1);
    expect(host.querySelector('input[placeholder="taglinePlaceholder"]')).toBeNull();
    expect(host.querySelector('input[placeholder="developerPlaceholder"]')).toBeNull();
    expect(latest.listing.developer).toBe("Crew");
  });

  it("preserves the saved screenshot order and removes the selected screenshot", async () => {
    initial.listing.screenshotAssetIds = [SECOND, FIRST];
    await render();
    expect(latest.listing.screenshotAssetIds).toEqual([SECOND, FIRST]);
    const displayedShots = [...host.querySelectorAll<HTMLImageElement>("img")]
      .map((image) => image.src)
      .filter((src) => src.includes(FIRST) || src.includes(SECOND));
    expect(displayedShots).toEqual([
      `https://media.example/${SECOND}.jpg`,
      `https://media.example/${FIRST}.jpg`,
    ]);
    displayedShots.forEach((source, index) => {
      const remove = button(`removeScreenshot ${index + 1}`);
      expect(remove.getAttribute("aria-label")).toBe(`removeScreenshot ${index + 1}`);
      expect(remove.parentElement?.querySelector<HTMLImageElement>("img")?.src).toBe(source);
      expect(remove.parentElement?.textContent?.trim()).toBe("");
    });
    await click(button("removeScreenshot 1"));
    expect(latest.listing.screenshotAssetIds).toEqual([FIRST]);
    expect(latest.listing.developer).toBe("Crew");
    expect(
      button("removeScreenshot 1").parentElement?.querySelector<HTMLImageElement>("img")?.src
    ).toBe(`https://media.example/${FIRST}.jpg`);
  });

  it("prevents selecting unavailable or duplicate screenshots while accepting unreviewed ready images", async () => {
    initial.listing.screenshotAssetIds = [];
    await render();
    await click(button("addScreenshot"));
    expect(pick(BLOCKED)!.disabled).toBe(true);
    expect(pick(FAILED)!.disabled).toBe(true);
    expect(pick(BLOCKED)!.textContent).toContain("mediaBlocked");
    expect(pick(FAILED)!.textContent).toContain("mediaNotReady");
    await click(pick(BLOCKED)!);
    await click(pick(FAILED)!);
    expect(h.changed).not.toHaveBeenCalled();
    expect(pick(FIRST)!.disabled).toBe(false);
    await click(pick(FIRST)!);
    expect(latest.listing.screenshotAssetIds).toEqual([FIRST]);
    expect(h.refresh).toHaveBeenCalledOnce();
    await click(button("addScreenshot"));
    expect(pick(FIRST)!.disabled).toBe(true);
    expect(pick(FIRST)!.textContent).toContain("screenshotAlreadyAdded");
    expect(pick(VIDEO)).toBeUndefined();
  });

  it("renders the selected trailer as video and allows removing it", async () => {
    await render();
    const trailer = host.querySelector<HTMLVideoElement>("video[controls]")!;
    expect(trailer.src).toBe("https://media.example/trailer.mp4");
    expect(h.image).not.toHaveBeenCalledWith("https://media.example/trailer.mp4");
    await click(button("removeTrailer"));
    expect(latest.listing.trailerAssetId).toBeNull();
    expect(host.querySelector("video")).toBeNull();
  });

  it("disables editing controls while retaining the selected media for read-only collaborators", async () => {
    disabled = true;
    await render();
    const editor = host.querySelector("div.space-y-9")!;
    expect(
      [...editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(
        (node) => node.disabled
      )
    ).toBe(true);
    expect(
      [...editor.querySelectorAll<HTMLButtonElement>("button")].every((node) => node.disabled)
    ).toBe(true);
    expect(
      host.querySelector<HTMLTextAreaElement>('textarea[placeholder="descriptionPlaceholder"]')
        ?.value
    ).toBe("A film\n\nChoose a path\n\nYour choices matter.");
    expect(host.querySelector("video[controls]")).not.toBeNull();
    expect(h.changed).not.toHaveBeenCalled();
  });
});

async function render() {
  await act(async () => root.render(<Harness />));
}
async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
}
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text
  );
  if (!found) throw new Error(`Button ${text} was not rendered`);
  return found;
}
function pick(id: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="pick ${id}"]`) ?? undefined;
}
function asset(id: string, overrides: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    id,
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    contentType: "image/jpeg",
    width: 800,
    height: 600,
    durationSeconds: null,
    checksumSha256: null,
    previewUrl: `https://media.example/${id}.jpg`,
    ...overrides,
  };
}
function candidate(media: MediaAssetSummary): StoryCandidateAsset {
  return { asset: media, videoVariant: null, addedAt: "", addedByUserId: "alice" };
}
