import type { Metadata } from "next";
import Link from "next/link";
import { IconArtboard } from "@tabler/icons-react";
import { CANVAS_PROJECTS } from "@/app/canvas/_data/projects";

export const metadata: Metadata = {
  title: "Canvas · FizzStudio",
};

export default function CanvasProjectsPage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Canvas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Infinite boards for generating and arranging images.
      </p>

      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {CANVAS_PROJECTS.map((project) => (
          <Link
            key={project.id}
            href={`/canvas/${project.id}`}
            className="group rounded-xl bg-card p-2.5 transition-colors hover:bg-accent"
          >
            <div className="flex aspect-video items-center justify-center rounded-lg bg-muted">
              <IconArtboard
                className="size-8 text-white/25 transition-colors group-hover:text-white/40"
                stroke={1.5}
              />
            </div>
            <div className="px-1.5 pt-3 pb-1.5">
              <div className="truncate text-sm font-medium">{project.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{project.updatedAt}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
