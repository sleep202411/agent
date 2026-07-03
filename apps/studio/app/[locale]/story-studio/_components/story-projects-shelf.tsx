"use client";

import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconBook2, IconClock } from "@tabler/icons-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/app/_components/auth-provider";
import {
  listStoryProjects,
  type StoryProjectSummary,
  type StoryPublishState,
} from "@/lib/story-projects-api";
import { CreateStoryProjectButton } from "./create-story-project-button";

export const storyProjectsQueryKey = ["fizzstudio", "story-projects"] as const;

const PUBLISH_CHIP: Record<StoryPublishState, { label: string; className: string }> = {
  unpublished: { label: "Draft", className: "bg-white/12 text-white/70" },
  published: { label: "Published", className: "bg-white text-black" },
  offline: { label: "Offline", className: "bg-[#E52227]/18 text-[#ff9b9e]" },
};

function coverUrl(project: StoryProjectSummary): string | null {
  return project.coverAssetId
    ? `/aurora/media/assets/${encodeURIComponent(project.coverAssetId)}/content`
    : null;
}

function StoryProjectCard({ project }: { project: StoryProjectSummary }) {
  const chip = PUBLISH_CHIP[project.publishState] ?? PUBLISH_CHIP.unpublished;
  const cover = coverUrl(project);
  return (
    <Link
      href={`/story-studio/editor?projectId=${project.id}`}
      className="group relative block overflow-hidden rounded-[16px] bg-white/[0.05] shadow-[0_18px_42px_rgba(0,0,0,0.32)] transition duration-200 hover:-translate-y-1 hover:bg-white/[0.08] hover:shadow-[0_26px_70px_rgba(0,0,0,0.44)]"
    >
      <div className="relative aspect-video overflow-hidden bg-white/[0.04]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- private media access route
          <img
            src={cover}
            alt=""
            className="size-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <IconBook2 className="size-9 text-white/16" stroke={1.4} />
          </div>
        )}
        <span
          className={cn(
            "absolute top-2.5 left-2.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] uppercase",
            chip.className
          )}
        >
          {chip.label}
        </span>
      </div>
      <div className="p-3.5">
        <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-white">
          {project.title || "Untitled Story"}
        </h3>
        <p className="mt-1 line-clamp-2 min-h-[34px] text-[12px] leading-[17px] font-medium text-white/56">
          {project.summary || "No summary yet — open the canvas to keep building."}
        </p>
        <p className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/40">
          <IconClock className="size-3" stroke={2} />
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>
      </div>
    </Link>
  );
}

function ShelfSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="overflow-hidden rounded-[16px] bg-white/[0.05]">
          <div className="aspect-video animate-pulse bg-white/[0.06]" />
          <div className="space-y-2 p-3.5">
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.08]" />
            <div className="h-3 w-full animate-pulse rounded bg-white/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The user's REAL story projects (sovereign `/aurora/story-projects` list,
 * newest-updated first) — replaces the old hardcoded demo shelf as the primary
 * section. Signed-out browsing gets an honest sign-in prompt; an empty library
 * gets a prominent Create.
 */
export function StoryProjectsShelf() {
  const { user, loading: authLoading, signIn } = useAuth();

  const query = useQuery({
    queryKey: storyProjectsQueryKey,
    queryFn: listStoryProjects,
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  return (
    <section className="relative z-20 px-[47px] pt-10 lg:pl-[120px]">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-white">Your stories</h2>
          <p className="mt-1 text-[13px] font-medium text-white/48">
            Playable drafts you are building — open one to continue on the canvas.
          </p>
        </div>
        {user && (query.data?.length ?? 0) > 0 ? <CreateStoryProjectButton /> : null}
      </div>

      <div className="mt-5">
        {authLoading || (user && query.isPending) ? (
          <ShelfSkeleton />
        ) : !user ? (
          <div className="flex flex-col items-center rounded-[20px] bg-white/[0.045] px-6 py-14 text-center">
            <IconBook2 className="size-9 text-white/22" stroke={1.4} />
            <p className="mt-4 text-[15px] font-semibold text-white/85">
              Sign in to see your stories
            </p>
            <p className="mt-1 max-w-sm text-[13px] font-medium text-white/48">
              Your playable story projects live in your account and sync across devices.
            </p>
            <button
              type="button"
              onClick={signIn}
              className="mt-5 inline-flex h-10 items-center rounded-[15px] bg-white px-5 text-[14px] font-bold text-black transition hover:bg-white/90"
            >
              Sign In
            </button>
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center rounded-[20px] bg-white/[0.045] px-6 py-14 text-center">
            <IconAlertTriangle className="size-9 text-[#ff8b8e]" stroke={1.4} />
            <p className="mt-4 text-[15px] font-semibold text-white/85">
              Couldn&apos;t load your stories
            </p>
            <p className="mt-1 max-w-sm text-[13px] font-medium text-white/48">
              {query.error instanceof Error ? query.error.message : "Something went wrong."}
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-5 inline-flex h-10 items-center rounded-[15px] bg-white/10 px-5 text-[14px] font-bold text-white transition hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        ) : (query.data?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center rounded-[20px] bg-white/[0.045] px-6 py-14 text-center">
            <IconBook2 className="size-9 text-white/22" stroke={1.4} />
            <p className="mt-4 text-[15px] font-semibold text-white/85">No stories yet</p>
            <p className="mt-1 max-w-sm text-[13px] font-medium text-white/48">
              Create your first playable story — describe an idea and StoryOS drafts the structure,
              cast, and clues.
            </p>
            <div className="mt-5">
              <CreateStoryProjectButton />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {(query.data ?? []).map((project) => (
              <StoryProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
