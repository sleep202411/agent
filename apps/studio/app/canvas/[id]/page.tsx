import type { Metadata } from "next";
import { CanvasView } from "@/app/canvas/_components/canvas-view";

export const metadata: Metadata = {
  title: "Canvas · FizzStudio",
};

/** Immersive canvas editor — intentionally outside the (studio) chrome. */
export default async function CanvasDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  return (
    <div className="relative h-dvh">
      <CanvasView projectId={id} />
    </div>
  );
}
