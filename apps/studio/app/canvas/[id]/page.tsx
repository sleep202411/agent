import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { getCanvasProject } from "@/app/canvas/_data/projects";
import { CanvasView } from "@/app/canvas/_components/canvas-view";

export const metadata: Metadata = {
  title: "Canvas · FizzStudio",
};

/** Immersive canvas editor — intentionally outside the (studio) chrome. */
export default async function CanvasDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const project = getCanvasProject(id);
  const name = project?.name ?? "Untitled canvas";

  return (
    <div className="relative h-dvh">
      <CanvasView />
      <Link
        href="/canvas"
        aria-label="Back to canvas projects"
        className="absolute top-4 left-4 z-20 flex h-9 items-center gap-2 rounded-full bg-popover/90 pr-3.5 pl-2.5 text-sm font-medium shadow-md backdrop-blur-xl transition-colors hover:bg-accent"
      >
        <IconArrowLeft className="size-4" />
        {name}
      </Link>
    </div>
  );
}
