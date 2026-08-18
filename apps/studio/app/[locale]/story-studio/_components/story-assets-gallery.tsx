"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type AssetKind = "character" | "scene" | "prop";
type TabKey = "all" | AssetKind;

const TABS: TabKey[] = ["all", "character", "scene", "prop"];

// Mock data until the reference-slot backend is wired in — local seed images
// only, no network.
const MOCK_ASSETS: Array<{ id: string; kind: AssetKind; name: string; image: string }> = [
  {
    id: "c1",
    kind: "character",
    name: "Night Market Youth",
    image: "people-night-market-youth-portrait.jpg",
  },
  { id: "c2", kind: "character", name: "Mecha Pilot", image: "games-sci-fi-mecha-pilot.jpg" },
  { id: "c3", kind: "character", name: "Sky Paladin", image: "games-fantasy-sky-paladin.jpg" },
  {
    id: "c4",
    kind: "character",
    name: "Pixel Avatar",
    image: "reference-retro-pixel-avatar-maker.jpg",
  },
  {
    id: "c5",
    kind: "character",
    name: "Director Figure",
    image: "concept-collectible-director-figure.jpg",
  },
  { id: "s1", kind: "scene", name: "RPG Town Hub", image: "games-bright-rpg-town-hub.jpg" },
  { id: "s2", kind: "scene", name: "Seaside Town", image: "games-seaside-town-builder.jpg" },
  { id: "s3", kind: "scene", name: "Floating Islands", image: "games-floating-islands-glider.jpg" },
  {
    id: "s4",
    kind: "scene",
    name: "Creative Interior",
    image: "studio-dark-creative-interior.jpg",
  },
  {
    id: "s5",
    kind: "scene",
    name: "Virtual Production Set",
    image: "studio-virtual-production-set.jpg",
  },
  { id: "s6", kind: "scene", name: "Greenhouse", image: "games-cozy-greenhouse-sim.jpg" },
  { id: "p1", kind: "prop", name: "Inventory Set", image: "games-inventory-asset-showcase.jpg" },
  { id: "p2", kind: "prop", name: "Elemental Cards", image: "games-elemental-card-collection.jpg" },
  { id: "p3", kind: "prop", name: "Toolbox Kit", image: "concept-creative-toolbox-kit.jpg" },
  { id: "p4", kind: "prop", name: "Exploded View", image: "reference-product-exploded-view.jpg" },
  { id: "p5", kind: "prop", name: "Film Cube", image: "studio-miniature-film-cube.jpg" },
];

/**
 * Assets step — character / scene / prop gallery. Tab filter lives in the URL
 * (?kind=) so the view deep-links and survives refresh.
 */
export function StoryAssetsGallery() {
  const t = useTranslations("storyStudio.assetsPage");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const kindParam = searchParams.get("kind");
  const active: TabKey = TABS.includes(kindParam as TabKey) ? (kindParam as TabKey) : "all";

  const setTab = (tab: TabKey) => {
    router.replace(tab === "all" ? pathname : `${pathname}?kind=${tab}`, { scroll: false });
  };

  const assets =
    active === "all" ? MOCK_ASSETS : MOCK_ASSETS.filter((asset) => asset.kind === active);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-6 py-6">
          <nav
            className="inline-flex gap-1 rounded-2xl bg-white/[0.025] p-1.5"
            aria-label={t("tabs.all")}
          >
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={active === tab}
                onClick={() => setTab(tab)}
                className={cn(
                  "inline-flex h-9 items-center rounded-xl px-3.5 text-xs font-semibold transition",
                  active === tab
                    ? "bg-white/[0.09] text-white shadow-sm"
                    : "text-white/40 hover:bg-white/[0.04] hover:text-white/72"
                )}
              >
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </nav>

          <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4">
            {assets.map((asset) => (
              <figure
                key={asset.id}
                className="group relative aspect-square overflow-hidden rounded-2xl bg-white/[0.05]"
              >
                <Image
                  src={`/gallery/seed/${asset.image}`}
                  alt={asset.name}
                  fill
                  sizes="(max-width: 1024px) 33vw, 220px"
                  className="object-cover transition duration-300 group-hover:scale-[1.04]"
                />
                <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-3 pt-8 pb-2.5">
                  <span className="truncate text-xs font-semibold text-white/92">{asset.name}</span>
                  <span className="shrink-0 rounded-full bg-white/14 px-2 py-0.5 text-[10px] font-medium text-white/72 backdrop-blur">
                    {t(`tabs.${asset.kind}`)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
