"use client";

import { IconBookmark, IconDots, IconHeart } from "@tabler/icons-react";

/**
 * Gallery — imagine.art-style masonry of community creations (hover reveals the
 * actions / author overlay), per the requested look.
 *
 * PREVIEW ONLY: the tiles use royalty-free placeholder images + sample meta so
 * the layout can be evaluated. The real version wires to the generation/community
 * feed (see ImageStudio's feed for the data shape) — no faked numbers ship.
 */

interface SampleTile {
  seed: string;
  width: number;
  height: number;
  author: string;
  likes: number;
}

// Varied aspect ratios drive the masonry column heights.
const SAMPLE_TILES: SampleTile[] = [
  { seed: "fizz-01", width: 600, height: 880, author: "Naufil khan", likes: 10 },
  { seed: "fizz-02", width: 600, height: 420, author: "Mira S.", likes: 4 },
  { seed: "fizz-03", width: 600, height: 460, author: "Leo T.", likes: 21 },
  { seed: "fizz-04", width: 600, height: 760, author: "Aria", likes: 7 },
  { seed: "fizz-05", width: 600, height: 900, author: "Kenji", likes: 33 },
  { seed: "fizz-06", width: 600, height: 540, author: "Noor", likes: 2 },
  { seed: "fizz-07", width: 600, height: 700, author: "Dani", likes: 15 },
  { seed: "fizz-08", width: 600, height: 480, author: "Sasha", likes: 9 },
  { seed: "fizz-09", width: 600, height: 820, author: "Owen", likes: 12 },
  { seed: "fizz-10", width: 600, height: 600, author: "Priya", likes: 6 },
  { seed: "fizz-11", width: 600, height: 760, author: "Marco", likes: 18 },
  { seed: "fizz-12", width: 600, height: 440, author: "Yuki", likes: 5 },
  { seed: "fizz-13", width: 600, height: 880, author: "Tariq", likes: 27 },
  { seed: "fizz-14", width: 600, height: 520, author: "Elena", likes: 3 },
];

function GalleryTile({ tile }: { tile: SampleTile }) {
  return (
    <div className="group relative mb-4 break-inside-avoid overflow-hidden rounded-xl bg-card ring-1 ring-white/[0.04] transition-shadow hover:shadow-2xl hover:shadow-black/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://picsum.photos/seed/${tile.seed}/${tile.width}/${tile.height}`}
        alt=""
        loading="lazy"
        className="block w-full transition-transform duration-500 ease-out group-hover:scale-[1.04]"
      />

      {/* Hover overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      <button
        type="button"
        aria-label="Options"
        className="absolute top-2 left-2 flex size-8 items-center justify-center rounded-full bg-black/45 text-white/90 opacity-0 backdrop-blur-md transition-opacity hover:bg-black/65 group-hover:opacity-100"
      >
        <IconDots className="size-4" stroke={2} />
      </button>

      <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          aria-label="Save"
          className="flex size-8 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-md transition-colors hover:bg-black/65"
        >
          <IconBookmark className="size-4" stroke={1.8} />
        </button>
        <span className="flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md tabular-nums">
          {tile.likes}
          <IconHeart className="size-3.5" stroke={1.8} />
        </span>
      </div>

      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="flex size-6 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold text-white backdrop-blur-md">
          {tile.author.charAt(0).toUpperCase()}
        </span>
        <span className="text-xs font-medium text-white drop-shadow">{tile.author}</span>
      </div>

      <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-lg bg-black/45 text-xs font-semibold text-white/90 opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
        T
      </span>
    </div>
  );
}

export function GalleryPreview() {
  return (
    <section className="mt-16 pb-56">
      <h2 className="text-lg font-semibold">Gallery</h2>
      <div className="mt-4 columns-2 gap-4 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
        {SAMPLE_TILES.map((tile) => (
          <GalleryTile key={tile.seed} tile={tile} />
        ))}
      </div>
    </section>
  );
}
