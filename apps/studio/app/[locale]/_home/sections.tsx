"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Homepage content sections: the source-style Recent Projects rail under the
 * composer, compact model rows, and the ImagineArt 2.0 Gallery masonry grid.
 * Content imagery stays full-color; neutral product chrome follows the studio
 * theme.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowUpRight,
  IconBookmark,
  IconChevronRight,
  IconHeart,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { createProject, listProjects, type ProjectRef } from "@/lib/collab/projects-api";
import type { Theme } from "../_pollo/theme";

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
// Recent Projects — source-style enterprise rail: create tile + project cards.
// ---------------------------------------------------------------------------
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

type RecentProjectCard = {
  id: string;
  name: string;
  ownerName: string;
  updatedLabel: string;
  assets: number;
  credits: number;
  thumbnail?: "workflow";
  href?: string;
};

const REFERENCE_PROJECTS: RecentProjectCard[] = [
  {
    id: "reference-empty-1",
    name: "Untitled Workflow",
    ownerName: "Isaac",
    updatedLabel: "3 hrs ago",
    assets: 0,
    credits: 0,
  },
  {
    id: "reference-empty-2",
    name: "Untitled Workflow",
    ownerName: "Isaac",
    updatedLabel: "3 hrs ago",
    assets: 0,
    credits: 0,
  },
  {
    id: "reference-empty-3",
    name: "Untitled Workflow",
    ownerName: "Isaac",
    updatedLabel: "3 hrs ago",
    assets: 0,
    credits: 0,
  },
  {
    id: "reference-workflow",
    name: "Untitled Workflow",
    ownerName: "Isaac",
    updatedLabel: "6 days ago",
    assets: 1,
    credits: 1,
    thumbnail: "workflow",
  },
];

export function RecentProjects({ theme: t }: { theme: Theme }) {
  const router = useRouter();
  const { user, requireAuth } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const nudge = (dir: 1 | -1) =>
    scrollRef.current?.scrollBy({ left: dir * 296, behavior: "smooth" });
  const [creating, setCreating] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ["home-recent-projects", workspaceId],
    queryFn: () => listProjects(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const onCreate = async () => {
    requireAuth(async () => {
      if (!workspaceId || creating) return;
      setCreating(true);
      try {
        const project = await createProject(workspaceId, { name: "Untitled Workflow" });
        router.push(`/project/${project.id}`);
      } catch {
        setCreating(false);
        toast.error("Couldn't create the project. Please try again.");
      }
    });
  };

  const ownerName = user?.nickName?.trim() || user?.email || user?.phone || "Isaac";
  const cards = buildRecentProjectCards(projects, ownerName);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setCanScrollPrev(el.scrollLeft > 2);
      setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [cards.length]);

  return (
    <section className="pt-12">
      <div className="mb-2 flex items-end justify-between px-6">
        <h2 className="text-[18px] font-medium leading-7 text-white/90">Recent Projects</h2>
        <Link
          href="/projects"
          className="inline-flex h-8 items-center rounded-full px-2.5 text-[14px] font-medium leading-5 text-white/85 transition hover:bg-white/[0.06] hover:text-white"
        >
          Show All
        </Link>
      </div>
      <div className="relative px-6">
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto px-0 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <CreateProjectCard creating={creating} onCreate={onCreate} />
          {cards.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => nudge(-1)}
          className={`absolute top-1/2 left-4 size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white/80 backdrop-blur transition hover:bg-black/70 ${
            canScrollPrev ? "hidden md:grid" : "hidden"
          }`}
        >
          <IconChevronRight className="size-5 rotate-180" stroke={1.8} />
        </button>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => nudge(1)}
          className={`absolute top-1/2 right-4 size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white/80 backdrop-blur transition hover:bg-black/70 ${
            canScrollNext ? "hidden md:grid" : "hidden"
          }`}
          style={{ boxShadow: t.tabGlow }}
        >
          <IconChevronRight className="size-5" stroke={1.8} />
        </button>
      </div>
    </section>
  );
}

function buildRecentProjectCards(
  projects: ProjectRef[] | undefined,
  ownerName: string
): RecentProjectCard[] {
  const realProjects =
    projects?.slice(0, 10).map((project, index) => ({
      id: project.id,
      name: project.name || "Untitled Workflow",
      ownerName,
      updatedLabel: timeAgo(project.updatedAt),
      assets: index === 0 ? 1 : 0,
      credits: index === 0 ? 1 : 0,
      thumbnail: index === 0 ? ("workflow" as const) : undefined,
      href: `/project/${project.id}`,
    })) ?? [];

  if (realProjects.length >= 4) return realProjects;
  return [...realProjects, ...REFERENCE_PROJECTS.slice(realProjects.length)];
}

function CreateProjectCard({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      disabled={creating}
      aria-busy={creating}
      className="group relative w-[280px] max-w-[calc(100vw-32px)] shrink-0 cursor-pointer space-y-3 rounded-[20px] border border-white/[0.075] bg-[#171717] px-2.5 py-3 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] outline-none transition hover:border-white/[0.12] hover:shadow-[0_8px_24px_rgba(0,0,0,0.22)] disabled:cursor-not-allowed"
    >
      <span className="block aspect-video w-full opacity-0" />
      <span className="block h-10 opacity-0" />
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        {creating ? (
          <IconLoader2 className="size-8 animate-spin text-white/80" stroke={1.5} />
        ) : (
          <span className="grid size-10 place-items-center rounded-full bg-white text-[#0f0f0f] transition group-hover:scale-105">
            <IconPlus className="size-6" stroke={1.8} />
          </span>
        )}
        <span className="text-[14px] font-medium leading-5 text-white/90">Create new project</span>
      </span>
    </button>
  );
}

function ProjectCard({ project }: { project: RecentProjectCard }) {
  const body = (
    <article className="group w-[280px] max-w-[calc(100vw-32px)] shrink-0 cursor-pointer overflow-hidden rounded-[16px] border border-white/[0.075] bg-[#151515] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition hover:border-white/[0.13] hover:shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
      <div className="p-1">
        <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-[#242424]">
          {project.thumbnail === "workflow" ? <WorkflowPreview /> : null}
          <ProjectMetrics assets={project.assets} credits={project.credits} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 pt-2">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold leading-5 text-white/90">
            {project.name}
          </h3>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-white/55">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#83562a] text-[11px] font-semibold text-[#ffce92]">
              {project.ownerName.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{project.ownerName}</span>
            <span className="shrink-0">-</span>
            <span className="truncate">{project.updatedLabel}</span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Project actions"
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/90 transition hover:bg-white/[0.08]"
          onClick={(event) => event.preventDefault()}
        >
          <DotsIcon />
        </button>
      </div>
    </article>
  );

  return project.href ? (
    <Link href={project.href} className="block shrink-0">
      {body}
    </Link>
  ) : (
    <div className="shrink-0">{body}</div>
  );
}

function ProjectMetrics({ assets, credits }: { assets: number; credits: number }) {
  return (
    <div className="absolute right-2 bottom-2 flex items-center gap-2">
      <MetricPill icon={<AssetIcon />} value={assets} label={assets === 1 ? "Asset" : "Assets"} />
      <MetricPill
        icon={<CreditIcon />}
        value={credits}
        label={credits === 1 ? "Credit" : "Credits"}
      />
    </div>
  );
}

function MetricPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span className="flex h-6 items-center gap-1 rounded-full bg-[#101010]/90 px-2 text-[14px] font-semibold leading-none text-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.32)] ring-1 ring-white/[0.05]">
      <span className="text-white/75">{icon}</span>
      {value} {label}
    </span>
  );
}

function WorkflowPreview() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#242424]">
      <div className="absolute inset-0 opacity-[0.22] [background-image:radial-gradient(circle,rgba(255,255,255,0.35)_1px,transparent_1.4px)] [background-size:18px_18px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 356 201" fill="none">
        <path
          d="M60 70 C102 68 106 124 151 121"
          stroke="#9A6528"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M209 90 C257 72 257 42 318 49"
          stroke="#5E853B"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M209 90 C255 105 262 142 318 139"
          stroke="#5E853B"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <circle cx="60" cy="70" r="2.6" fill="#A16A2B" />
        <circle cx="151" cy="121" r="2.6" fill="#A16A2B" />
        <circle cx="209" cy="90" r="3" fill="#66933F" />
        <circle cx="318" cy="49" r="2.6" fill="#66933F" />
        <circle cx="318" cy="139" r="2.6" fill="#66933F" />
      </svg>
      <WorkflowNode className="left-[22px] top-[52px]" width={50} lines={3} />
      <WorkflowNode className="left-[130px] top-[104px]" width={82} lines={2} />
      <WorkflowNode className="left-[185px] top-[73px]" width={52} lines={3} />
      <WorkflowNode className="left-[292px] top-[32px]" width={74} lines={3} />
      <WorkflowNode className="left-[292px] top-[121px]" width={74} lines={2} />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
    </div>
  );
}

function WorkflowNode({
  className,
  width,
  lines,
}: {
  className: string;
  width: number;
  lines: number;
}) {
  return (
    <div
      className={`absolute rounded-[5px] bg-[#171717]/90 px-2 py-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.06] ${className}`}
      style={{ width }}
    >
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className="mb-1 block h-[3px] rounded-full bg-white/20 last:mb-0"
          style={{ width: `${index === 0 ? 70 : index === 1 ? 100 : 48}%` }}
        />
      ))}
    </div>
  );
}

function AssetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 1.6 12 3.9v5.2l-4.5 2.3L3 9.1V3.9l4.5-2.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3.3 4.1 7.5 6.3l4.2-2.2M7.5 6.4v4.7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CreditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 1.8 9 5.9l4.2 1.6L9 9.1l-1.5 4.1L6 9.1 1.8 7.5 6 5.9l1.5-4.1Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </svg>
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
// ImagineArt 2.0 Gallery — source homepage masonry grid.
// ---------------------------------------------------------------------------
type GalleryItem = {
  title: string;
  src: string;
  avatar: string;
  creator: string;
  likes: number;
  aspect: number;
};

const GALLERY_GAP = 8;
const GALLERY_ITEMS: GalleryItem[] = [
  {
    title: "Stylish Urban Portrait",
    src: "https://asset.imagine.art/video/thumbnails/69c821a5-b495-4c1a-a098-030815ba42c5",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/3f0ea49b-d39a-49df-81cc-e243081516b2",
    creator: "Naufil khan",
    likes: 10,
    aspect: 9 / 16,
  },
  {
    title: "Fiery Rider",
    src: "https://asset.imagine.art/video/thumbnails/baeffda8-f3b8-4eb5-b8a5-ddcf0545c51c",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/331a1a88-1430-4a57-9812-6fd92e1ddf39",
    creator: "Rhys",
    likes: 1,
    aspect: 16 / 9,
  },
  {
    title: "Nomadic Yak Rider",
    src: "https://asset.imagine.art/video/thumbnails/16267eb7-2ee2-4f87-9bd1-a7316dacff27",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/751e31e8-7724-43af-a681-e659ec01741b",
    creator: "Muzzi",
    likes: 7,
    aspect: 16 / 9,
  },
  {
    title: "Abandoned Bus Portrait",
    src: "https://asset.imagine.art/video/thumbnails/93f871f8-ee17-4239-83c6-92e1dd48777f",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/0ac0f247-2b65-43c3-ad6d-ea6a666896c5",
    creator: "Galih digitalaii",
    likes: 3,
    aspect: 9 / 16,
  },
  {
    title: "Cyberpunk Fashion",
    src: "https://asset.imagine.art/video/thumbnails/86d56ea8-c6ed-49c9-825e-dc82d0122dea",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 7,
    aspect: 3 / 4,
  },
  {
    title: "Burning Car",
    src: "https://asset.imagine.art/video/thumbnails/93533410-f26b-4b28-a25d-6ebcd30dd63e",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 7,
    aspect: 3 / 4,
  },
  {
    title: "Library Portrait",
    src: "https://asset.imagine.art/video/thumbnails/a345527e-4fe5-4b96-b8e2-7e344217dc7a",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/4ce70175-d35f-4fdc-bcc0-7668010573a2",
    creator: "The Lofe",
    likes: 3,
    aspect: 16 / 9,
  },
  {
    title: "Night Fashion Portrait",
    src: "https://asset.imagine.art/video/thumbnails/4dd9f84f-d190-4570-b3de-97ba5152cbde",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/4ce70175-d35f-4fdc-bcc0-7668010573a2",
    creator: "The Lofe",
    likes: 3,
    aspect: 16 / 9,
  },
  {
    title: "Elevator Fashion Portrait",
    src: "https://asset.imagine.art/video/thumbnails/973072f1-1335-4eef-a365-bc734a127028",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/4ce70175-d35f-4fdc-bcc0-7668010573a2",
    creator: "The Lofe",
    likes: 3,
    aspect: 16 / 9,
  },
  {
    title: "Anime City Portrait",
    src: "https://asset.imagine.art/video/thumbnails/e5387755-f00a-4042-a1c5-02f62feff69f",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/d075d51a-e96a-4ea0-ade5-7ad602e5d466",
    creator: "Mahnoor Shahzad",
    likes: 9,
    aspect: 9 / 16,
  },
  {
    title: "Desert Road Journey",
    src: "https://asset.imagine.art/video/thumbnails/62928f29-27af-4905-9fda-854d5e41a97d",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/62aecaa7-773a-4ece-8a17-611d00fe932a",
    creator: "Shamama",
    likes: 4,
    aspect: 1,
  },
  {
    title: "Astronaut In Vortex",
    src: "https://asset.imagine.art/video/thumbnails/bf67e452-cb3e-4dcf-853c-472fc6eead94",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/e3d32dc4-a07d-433c-9923-d03e83b42788",
    creator: "Maha manzoor",
    likes: 1,
    aspect: 9 / 16,
  },
  {
    title: "Child and Rhino",
    src: "https://asset.imagine.art/video/thumbnails/3bff33c7-64cb-43b5-916a-23de071ec428",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/d7e5efe4-5843-4128-b105-f72054ed2548",
    creator: "GeniArt",
    likes: 7,
    aspect: 3 / 2,
  },
  {
    title: "Violinist's Storm",
    src: "https://asset.imagine.art/video/thumbnails/67a307f2-a24a-4258-a9ea-64c0c2dde81d",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 2,
    aspect: 3 / 4,
  },
  {
    title: "Intense Portrait",
    src: "https://asset.imagine.art/video/thumbnails/66bcd3c6-3d08-4e56-b447-76ae02eba6f8",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 4,
    aspect: 3 / 4,
  },
  {
    title: "Cyberpunk Samurai",
    src: "https://asset.imagine.art/video/thumbnails/9d8bd933-0bc6-4dc3-a2ad-d79593c0c087",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 6,
    aspect: 3 / 4,
  },
  {
    title: "Neon Night Portrait",
    src: "https://asset.imagine.art/video/thumbnails/a53f4250-5df0-43e9-bebc-dc6b88f1b003",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 0,
    aspect: 3 / 4,
  },
  {
    title: "Action Explosion",
    src: "https://asset.imagine.art/video/thumbnails/7626f78f-ee98-4fb7-b207-fd1b5af20658",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 3,
    aspect: 3 / 4,
  },
  {
    title: "Rainy Night Portrait",
    src: "https://asset.imagine.art/video/thumbnails/ec06d2d9-f4b8-49ba-be7c-3599d00da9a7",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 4,
    aspect: 3 / 4,
  },
  {
    title: "Surreal Fashion",
    src: "https://asset.imagine.art/video/thumbnails/f36ac337-c9ae-4083-9da6-f152fdb62f5c",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 7,
    aspect: 3 / 4,
  },
  {
    title: "Cyberpunk Astronaut",
    src: "https://asset.imagine.art/video/thumbnails/c7ede114-3f7b-4a89-83d5-3ad5e2944663",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 2,
    aspect: 3 / 4,
  },
  {
    title: "Custom Black Motorcycle",
    src: "https://asset.imagine.art/video/thumbnails/f5f263e1-ff3e-43e0-a50b-8de1a5748184",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/7aa18011-e7a9-4af0-90cf-b1693771f6ab",
    creator: "Muhammad Haris",
    likes: 4,
    aspect: 3 / 4,
  },
  {
    title: "Cosmic Portrait",
    src: "https://asset.imagine.art/video/thumbnails/a1f5e951-0b7e-4fdc-b90d-1940e2bbe6da",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 4,
    aspect: 3 / 4,
  },
  {
    title: "Astronaut Skateboarding",
    src: "https://asset.imagine.art/video/thumbnails/ddb895cd-bb85-43d4-8d62-814b0e7059ed",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/7aa18011-e7a9-4af0-90cf-b1693771f6ab",
    creator: "Muhammad Haris",
    likes: 4,
    aspect: 3 / 4,
  },
  {
    title: "Botanical Fashion Portrait",
    src: "https://asset.imagine.art/video/thumbnails/58dd8c45-4a99-4cb4-8646-b469e3be6d2c",
    avatar:
      "https://profile-image.cdn.imagine.art/profile-image/user/profile/imagine/dec1ed8b-abd2-454f-b0d4-97a0b80d4e10",
    creator: "Max casu",
    likes: 5,
    aspect: 3 / 4,
  },
];

type GalleryPosition = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function ExploreMore() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const columns = getGalleryColumnCount(gridWidth);
  const { height, positions } = useMemo(
    () => getGalleryLayout(gridWidth, columns),
    [columns, gridWidth]
  );

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const update = () => setGridWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="px-4 pt-16 sm:px-6 lg:px-12">
      <div className="relative flex w-full flex-col gap-4 pb-4">
        <h2 className="text-[20px] font-medium leading-6 text-white/95">ImagineArt 2.0 Gallery</h2>
        <div
          ref={gridRef}
          className="relative min-h-[400px] w-full overflow-hidden rounded-[8px]"
          style={{ height: height || 400 }}
        >
          {GALLERY_ITEMS.map((item, index) => (
            <GalleryCard key={item.src} item={item} position={positions[index]} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-56 items-end justify-center bg-[linear-gradient(180deg,rgba(18,18,18,0)_0%,oklch(0.17_0_0)_44.23%)]">
          <a
            href="https://www.imagine.art/community/models/imagineart-2-0"
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto inline-flex h-10 w-[290.5px] items-center justify-center gap-2 rounded-[16px] bg-[rgba(105,41,196,0.3)] px-3 py-2.5 text-[16px] font-medium leading-5 text-[rgb(212,187,255)] transition-colors hover:bg-[rgba(105,41,196,0.4)] active:translate-y-px"
          >
            Explore ImagineArt 2.0 Gallery
            <IconArrowUpRight className="size-4.5" stroke={1.8} />
          </a>
        </div>
      </div>
    </section>
  );
}

function GalleryCard({ item, position }: { item: GalleryItem; position?: GalleryPosition }) {
  if (!position) return null;

  return (
    <button
      type="button"
      aria-label={item.title}
      className="group absolute overflow-hidden rounded-[8px] bg-[#191919] text-left outline-none transition-transform duration-300 hover:z-10 focus-visible:ring-2 focus-visible:ring-white/45"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
      }}
    >
      <img src={item.src} alt={item.title} loading="lazy" className="size-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.4)_10.65%,rgba(0,0,0,0)_24.69%),linear-gradient(180deg,rgba(0,0,0,0)_82.1%,rgba(0,0,0,0.4)_100%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <div className="absolute inset-x-2 top-2 flex items-center justify-between">
          <span className="pointer-events-auto grid size-7 place-items-center rounded-[10px] border border-white/10 bg-[#2d2d2d]/70 text-white/80 opacity-90 backdrop-blur-[6px]">
            <DotsIcon />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="pointer-events-auto grid size-7 place-items-center rounded-[10px] border border-white/10 bg-[#2d2d2d]/70 text-white/85 opacity-90 backdrop-blur-[6px]">
              <IconBookmark className="size-4" stroke={1.7} />
            </span>
            <span className="pointer-events-auto flex h-7 items-center gap-1 rounded-[10px] border border-white/10 bg-[#2d2d2d]/70 px-2 text-[13px] font-medium leading-none text-white/90 opacity-90 backdrop-blur-[6px]">
              {item.likes}
              <IconHeart className="size-4" stroke={1.7} />
            </span>
          </span>
        </div>
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
          <img
            src={item.avatar}
            alt="Owner profile image"
            loading="lazy"
            className="size-7 shrink-0 rounded-full object-cover"
          />
          <span className="truncate text-[18px] font-medium leading-6 text-white/80">
            {item.creator}
          </span>
        </div>
      </div>
    </button>
  );
}

function getGalleryColumnCount(width: number) {
  if (width >= 1320) return 5;
  if (width >= 900) return 3;
  if (width >= 620) return 2;
  return 1;
}

function getGalleryLayout(width: number, columns: number) {
  if (!width || !columns) return { height: 0, positions: [] as GalleryPosition[] };

  const columnWidth = (width - GALLERY_GAP * (columns - 1)) / columns;
  const columnHeights = Array.from({ length: columns }, () => 0);
  const positions = GALLERY_ITEMS.map((item) => {
    const column = columnHeights.indexOf(Math.min(...columnHeights));
    const height = columnWidth / item.aspect;
    const position = {
      left: column * (columnWidth + GALLERY_GAP),
      top: columnHeights[column],
      width: columnWidth,
      height,
    };
    columnHeights[column] += height + GALLERY_GAP;
    return position;
  });

  return {
    height: Math.max(...columnHeights),
    positions,
  };
}
