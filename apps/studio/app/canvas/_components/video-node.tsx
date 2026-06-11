"use client";

import { memo } from "react";
import { useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { IconArrowUp, IconStack2, IconVideo, IconWand } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CanvasNodeToolbar } from "./node-toolbar";
import { Port } from "./ports";

export type VideoNodeType = Node<{ prompt: string; name?: string }, "video">;

const comingSoon = (label: string) => toast.info(`${label} · Coming soon`);

function VideoNodeComponent({ id, data, selected }: NodeProps<VideoNodeType>) {
  const { updateNodeData } = useReactFlow();

  return (
    <div className="relative">
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false} />

      {/* Header row: node name left, model right. */}
      <div className="flex items-center justify-between px-1 pb-1.5 text-xs">
        <span className="flex items-center gap-1.5 text-white/80">
          <IconVideo className="size-3.5" stroke={1.8} />
          {data.name ?? "Video"}
        </span>
        <button
          type="button"
          onClick={() => comingSoon("Model picker")}
          className="nodrag text-muted-foreground transition-colors hover:text-white/80"
        >
          Auto
        </button>
      </div>

      <div
        className={cn(
          "w-[360px] overflow-hidden rounded-2xl bg-card shadow-xl shadow-black/40",
          selected && "ring-2 ring-ring"
        )}
      >
        {/* Result area — 16:9 for video */}
        <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-muted">
          <IconVideo className="size-7 text-white/30" stroke={1.5} />
          <p className="text-sm text-white/45">Results will appear here.</p>
        </div>

        {/* In-node composer */}
        <div className="p-3">
          <textarea
            value={data.prompt}
            onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
            placeholder="Write your prompt.."
            rows={2}
            className="nodrag block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => comingSoon("References")}
              className="nodrag flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.1]"
            >
              <IconStack2 className="size-3.5" stroke={1.8} />
              References
            </button>
            <div className="flex-1" />
            <button
              type="button"
              aria-label="Enhance prompt"
              onClick={() => comingSoon("Prompt enhance")}
              className="nodrag flex size-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <IconWand className="size-4" stroke={1.8} />
            </button>
            <button
              type="button"
              aria-label="Generate"
              onClick={() => comingSoon("Generation")}
              className="nodrag flex size-8 items-center justify-center rounded-full bg-white/[0.08] text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
            >
              <IconArrowUp className="size-4" stroke={2} />
            </button>
          </div>
        </div>
      </div>

      {/* Typed ports */}
      <Port type="target" id="prompt" side="left" top={64} label="Prompt" required />
      <Port type="target" id="reference" side="left" top={100} label="Reference Image" />
      <Port type="source" id="video" side="right" top={64} label="Video" />
    </div>
  );
}

export const VideoNode = memo(VideoNodeComponent);
