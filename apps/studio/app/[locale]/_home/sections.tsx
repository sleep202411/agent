"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Homepage content sections faithful to pollo.ai: the Recent Projects rail under
 * the composer, the Models 4-col grid, and the Explore More image grid. Uses
 * pollo's real CDN imagery (content images stay full-color in every theme — only
 * brand logos get the monochrome filter). Accent (badges / "View more" / promos)
 * follows the theme.
 */

import { useRef } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { Theme } from "../_pollo/theme";

const CDN = "https://cdn.pollo.ai/prod/public/images/home";
const MODEL_CDN = "https://videocdn.pollo.ai/web-cdn/pollo";

function SectionHeading({ title, action }: { title: string; action?: string }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      {action ? (
        <button
          type="button"
          className="flex items-center gap-1 text-[13px] text-white/55 transition hover:text-white/85"
        >
          {action}
          <IconChevronRight className="size-4" stroke={1.8} />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Projects (the user's recent work) — horizontal scroll ONLY, never
// wraps; the ← / → arrows nudge the row. Placeholder data for now; wire to the
// real local project store later (studio has project CRUD) — see follow-ups.
// ---------------------------------------------------------------------------
const RECENT_PROJECTS: { name: string; meta: string; thumb: string }[] = [
  { name: "Sunset sneaker ad", meta: "Edited 2h ago", thumb: "/presets/marketing-ad.jpg" },
  { name: "Couture trailer", meta: "Edited yesterday", thumb: "/presets/fashion-trailer.jpg" },
  { name: "Weekend vlog intro", meta: "Edited 2 days ago", thumb: "/presets/youtube-vlog.jpg" },
  { name: "Brand key visual", meta: "Edited 3 days ago", thumb: "/presets/brand-visuals.jpg" },
  { name: "Product hero shots", meta: "Edited last week", thumb: "/presets/marketing-ad.jpg" },
  { name: "Launch teaser", meta: "Edited last week", thumb: "/presets/fashion-trailer.jpg" },
];

export function RecentProjects({ theme: t }: { theme: Theme }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nudge = (dir: 1 | -1) =>
    scrollRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });

  return (
    <section className="px-6 pt-12">
      <SectionHeading title="Recent Projects" action="View all" />
      <div className="relative">
        {/* flex (never wraps) + overflow-x: horizontal scroll only */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {RECENT_PROJECTS.map((p, i) => (
            <button
              key={i}
              type="button"
              className="group flex w-[300px] shrink-0 flex-col gap-2.5 text-left"
            >
              <div className="aspect-video overflow-hidden rounded-2xl ring-1 ring-white/[0.08]">
                <img
                  src={p.thumb}
                  alt={p.name}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div>
                <div className="truncate text-[14px] font-medium">{p.name}</div>
                <div className="text-[12px] text-white/45">{p.meta}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => nudge(-1)}
          className="absolute top-[84px] -left-3 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur transition hover:bg-black/80"
        >
          <IconChevronLeft className="size-5" stroke={1.8} />
        </button>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => nudge(1)}
          className="absolute top-[84px] -right-3 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur transition hover:bg-black/80"
          style={{ boxShadow: t.tabGlow }}
        >
          <IconChevronRight className="size-5" stroke={1.8} />
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Models (4-col grid of compact rows)
// ---------------------------------------------------------------------------
const MODELS: {
  name: string;
  img: string;
  desc: string;
  badges: { text: string; kind: "new" | "off" | "muted" }[];
}[] = [
  {
    name: "Seedance 2.0",
    img: `${MODEL_CDN}/production/cm3po9yyf0003oh0c2iyt8ajy/image/1754894158793-1e7ef687-c3c1-4f44-8b06-d044a8121f66.svg`,
    desc: "Fluid, cohesive multi-shot video outputs",
    badges: [
      { text: "New", kind: "new" },
      { text: "50% OFF", kind: "off" },
    ],
  },
  {
    name: "Sora 2",
    img: `${MODEL_CDN}/test/cm3pol28q0000ojuuyeo77e36/image/1759998830447-10c6484e-786d-4d05-a2c4-f0c929b1042b.svg`,
    desc: "Realistic visuals & audio (supports face uploads)",
    badges: [{ text: "Audio", kind: "muted" }],
  },
  {
    name: "Veo 3",
    img: `${MODEL_CDN}/production/cm3po9yyf0003oh0c2iyt8ajy/image/1753259785486-de7c53b0-9576-4d3e-a76a-a94fcac57bf1.svg`,
    desc: "Realistic outputs with natural audio",
    badges: [],
  },
  {
    name: "Veo 3.1",
    img: `${MODEL_CDN}/production/cm3po9yyf0003oh0c2iyt8ajy/image/1753259785486-de7c53b0-9576-4d3e-a76a-a94fcac57bf1.svg`,
    desc: "Frame to frame control & multi-image reference",
    badges: [{ text: "Audio", kind: "muted" }],
  },
  {
    name: "HappyHorse 1.0",
    img: `${MODEL_CDN}/production/cm28rh3bi0000oh09cxvjkeky/image/1777279556897-394c84db-0a26-4b50-990b-8184addb63fa.svg`,
    desc: "Cinematic realism with native audio-visual sync",
    badges: [
      { text: "New", kind: "new" },
      { text: "80% OFF", kind: "off" },
    ],
  },
  {
    name: "Nano Banana 2",
    img: `${MODEL_CDN}/production/cm28rh3bi0000oh09cxvjkeky/image/1763647743647-46f3d8cf-3b10-4643-b245-8fa62358d74e.svg`,
    desc: "Faster high-fidelity image generation",
    badges: [
      { text: "New", kind: "new" },
      { text: "Unlimited Free", kind: "muted" },
    ],
  },
  {
    name: "GPT Image 2.0",
    img: `${MODEL_CDN}/production/cmjcpqbto01pciumr1glww7ne/image/1776672746985-d87dadd4-e935-4a3b-8183-849f7a7c951d.svg`,
    desc: "Near-perfect text and extreme precision",
    badges: [
      { text: "New", kind: "new" },
      { text: "Unlimited Free", kind: "muted" },
    ],
  },
  {
    name: "Seedream 5.0 Lite",
    img: `${MODEL_CDN}/test/cm97uxg1v000m1490lu4pqgla/image/1757657687665-71703205-e9ea-4ec1-86d6-5a8a5cd5a9f8.svg`,
    desc: "Real-time web retrieval & precise editing controls",
    badges: [
      { text: "New", kind: "new" },
      { text: "Unlimited Free", kind: "muted" },
    ],
  },
];

export function Models({ theme: t }: { theme: Theme }) {
  return (
    <section className="px-6 pt-16">
      <SectionHeading title="Models" action="View more" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODELS.map((m) => (
          <button
            key={m.name}
            type="button"
            className="group flex items-center gap-3 rounded-xl p-3 text-left transition hover:brightness-125"
            style={{ background: t.surface }}
          >
            <img
              src={m.img}
              alt={m.name}
              loading="lazy"
              className="size-11 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{m.name}</span>
                {m.badges.map((b) => (
                  <span
                    key={b.text}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={
                      b.kind === "off"
                        ? { color: t.price, background: "rgba(255,255,255,0.04)" }
                        : b.kind === "new"
                          ? { color: t.genText, background: t.genBg }
                          : { color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.07)" }
                    }
                  >
                    {b.text}
                  </span>
                ))}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-white/45">{m.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Explore More AI Features (image grid)
// ---------------------------------------------------------------------------
const EXPLORE: { label: string; slug: string }[] = [
  { label: "AI Video Generator", slug: "img-ai-video-generator" },
  { label: "Text to Video AI", slug: "img-text-to-video-ai" },
  { label: "Image to Video AI", slug: "img-image-to-video-ai" },
  { label: "Reference to Video", slug: "img-reference-to-video" },
  { label: "Video to Video AI", slug: "img-video-to-video-ai" },
  { label: "Photo to Video Avatar", slug: "img-photo-to-video-avatar" },
  { label: "AI Video Editor", slug: "img-ai-video-editor" },
  { label: "Mimic Motion", slug: "img-mimic-motion" },
  { label: "Face Swap Video", slug: "img-ai-face-swap-video" },
  { label: "Animate a Picture", slug: "img-ai-animate-a-picture" },
  { label: "Video Upscaler", slug: "img-ai-video-upscaler" },
  { label: "Motion Control", slug: "img-ai-motion-control" },
  { label: "Remove Object from Video", slug: "img-ai-remove-object-from-video" },
  { label: "AI Video Extender", slug: "img-ai-video-extender" },
  { label: "AI Animation Generator", slug: "img-ai-animation-generator" },
  { label: "AI Sound Effect Generator", slug: "img-ai-sound-effect-generator" },
  { label: "Lip Sync AI", slug: "img-lip-sync-ai" },
  { label: "AI Pet Podcast Generator", slug: "img-ai-pet-podcast-generator" },
  { label: "Denoise Video", slug: "img-denoise-video" },
  { label: "Video Background Remover", slug: "img-video-background-remover" },
  { label: "Video to Anime", slug: "img-video-to-anime" },
  { label: "AI Hug Generator", slug: "img-ai-hug-generato" },
  { label: "Drunk Dance", slug: "img-drunk-dance" },
  { label: "Earth Zoom In", slug: "img-earth-zoom-in" },
];

export function ExploreMore() {
  return (
    <section className="px-6 pt-16">
      <SectionHeading title="Explore More AI Features" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {EXPLORE.map((e) => (
          <button key={e.label} type="button" className="group flex flex-col gap-2 text-left">
            <div className="aspect-[4/3] overflow-hidden rounded-xl bg-white/[0.04]">
              <img
                src={`${CDN}/explore-more/${e.slug}.jpg`}
                alt={e.label}
                loading="lazy"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            <span className="text-[13px] text-white/70 transition group-hover:text-white">
              {e.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
