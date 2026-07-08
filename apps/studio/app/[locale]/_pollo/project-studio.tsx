"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Project Studio surface (the 2nd homepage tab). Our canvas is just ONE UIUX of
 * a "project", so this tab is the entry into the project/canvas workspace:
 * a blank canvas + our REAL workflow presets (bundled samples in /public/presets,
 * produced by our own pipeline). Each card opens the canvas (`/<locale>/canvas`),
 * presets carry `?preset=<id>` for the canvas to apply. Themed via `theme`.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { Theme } from "./theme";

const PRESETS = [
  {
    id: "marketing-ad",
    nameKey: "projectStudio.presets.marketingAd.name",
    descKey: "projectStudio.presets.marketingAd.description",
    thumb: "/presets/marketing-ad.jpg",
  },
  {
    id: "fashion-trailer",
    nameKey: "projectStudio.presets.fashionTrailer.name",
    descKey: "projectStudio.presets.fashionTrailer.description",
    thumb: "/presets/fashion-trailer.jpg",
  },
  {
    id: "youtube-vlog",
    nameKey: "projectStudio.presets.youtubeVlog.name",
    descKey: "projectStudio.presets.youtubeVlog.description",
    thumb: "/presets/youtube-vlog.jpg",
  },
  {
    id: "brand-visuals",
    nameKey: "projectStudio.presets.brandVisuals.name",
    descKey: "projectStudio.presets.brandVisuals.description",
    thumb: "/presets/brand-visuals.jpg",
  },
];

export function ProjectStudio({ theme: t }: { theme: Theme }) {
  const th = useTranslations("home");
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en-US";
  const canvasHref = `/${locale}/canvas`;

  return (
    <div className="mt-8 w-full">
      <p className="mb-6 text-center text-[14px] text-white/50">{th("projectStudio.intro")}</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
        {/* Blank canvas */}
        <Link href={canvasHref} className="group flex flex-col gap-2.5">
          <div
            className="grid aspect-[4/3] place-items-center rounded-2xl border border-dashed border-white/15 transition group-hover:border-white/35"
            style={{ background: t.surface }}
          >
            <span
              className="grid size-11 place-items-center rounded-full transition group-hover:brightness-110"
              style={{ background: t.genBg, color: t.genText }}
            >
              <IconPlus className="size-6" stroke={2} />
            </span>
          </div>
          <div>
            <div className="text-[14px] font-medium">{th("projectStudio.blankCanvas")}</div>
            <div className="text-[12px] text-white/45">{th("projectStudio.startFromScratch")}</div>
          </div>
        </Link>

        {/* Real workflow presets */}
        {PRESETS.map((p) => (
          <Link
            key={p.id}
            href={`${canvasHref}?preset=${p.id}`}
            className="group flex flex-col gap-2.5"
          >
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-white/[0.08]">
              <img
                src={p.thumb}
                alt={th(p.nameKey)}
                loading="lazy"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <span
                aria-hidden
                className="absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
                style={{ boxShadow: `inset 0 0 0 2px ${t.genBg}` }}
              />
            </div>
            <div>
              <div className="text-[14px] font-medium">{th(p.nameKey)}</div>
              <div className="text-[12px] text-white/45">{th(p.descKey)}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
