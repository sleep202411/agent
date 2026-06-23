"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Homepage content sections faithful to pollo.ai: the Recent Projects rail under
 * the composer, the Models 4-col grid, and the Explore More image grid. Uses
 * pollo's real CDN imagery (content images stay full-color in every theme — only
 * brand logos get the monochrome filter). Accent (badges / "View more" / promos)
 * follows the theme.
 */

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArtboard,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { useWorkspace } from "@/app/_components/workspace-context";
import { createProject, listProjects } from "@/lib/collab/projects-api";
import type { Theme } from "../_pollo/theme";

const CDN = "https://cdn.pollo.ai/prod/public/images/home";
const MODEL_CDN = "https://videocdn.pollo.ai/web-cdn/pollo";

function SectionHeading({
  title,
  action,
  actionHref,
}: {
  title: string;
  action?: string;
  actionHref?: string;
}) {
  const cls = "flex items-center gap-1 text-[13px] text-white/55 transition hover:text-white/85";
  const inner = (
    <>
      {action}
      <IconChevronRight className="size-4" stroke={1.8} />
    </>
  );
  return (
    <div className="mb-5 flex items-center justify-between">
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      {action ? (
        actionHref ? (
          <Link href={actionHref} className={cls}>
            {inner}
          </Link>
        ) : (
          <button type="button" className={cls}>
            {inner}
          </button>
        )
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Projects — the signed-in user's REAL projects (listProjects), with a
// Create-new tile up front. Horizontal scroll only; the ← / → arrows nudge the
// row. No fake asset/credit counts — ProjectRef doesn't carry them.
// ---------------------------------------------------------------------------
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function RecentProjects({ theme: t }: { theme: Theme }) {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const nudge = (dir: 1 | -1) =>
    scrollRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  const [creating, setCreating] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ["home-recent-projects", workspaceId],
    queryFn: () => listProjects(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const onCreate = async () => {
    if (!workspaceId || creating) return;
    setCreating(true);
    try {
      const project = await createProject(workspaceId, { name: "Untitled project" });
      router.push(`/project/${project.id}`);
    } catch {
      setCreating(false);
      toast.error("Couldn't create the project. Please try again.");
    }
  };

  // Recent Projects is the signed-in user's own work — nothing to show signed out.
  if (!workspaceId) return null;

  return (
    <section className="px-6">
      <SectionHeading title="Recent Projects" action="View all" actionHref="/projects" />
      <div className="relative">
        {/* flex (never wraps) + overflow-x: horizontal scroll only */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* Create new project — the sanctioned brand-red primary CTA (DESIGN.md §2) */}
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            aria-busy={creating}
            className="group flex w-[300px] shrink-0 flex-col gap-2.5 text-left outline-none disabled:cursor-not-allowed"
          >
            <div className="grid aspect-video place-items-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.08] transition group-hover:bg-white/[0.05]">
              {creating ? (
                <IconLoader2 className="size-8 animate-spin text-white/70" stroke={1.5} />
              ) : (
                <span className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition group-hover:brightness-110">
                  <IconPlus className="size-6" stroke={2} />
                </span>
              )}
            </div>
            <div>
              <div className="truncate text-[14px] font-medium">Create new project</div>
              <div className="text-[12px] text-white/45">Start a blank project</div>
            </div>
          </button>

          {projects?.map((p) => (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="group flex w-[300px] shrink-0 flex-col gap-2.5"
            >
              <div className="grid aspect-video place-items-center overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.08] transition group-hover:bg-white/[0.05]">
                <IconArtboard
                  className="size-9 text-white/15 transition-colors group-hover:text-white/30"
                  stroke={1.5}
                />
              </div>
              <div>
                <div className="truncate text-[14px] font-medium">{p.name}</div>
                <div className="text-[12px] text-white/45">Edited {timeAgo(p.updatedAt)}</div>
              </div>
            </Link>
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
