import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { IconPlayerPlay, IconFlag, IconFlagFilled, IconVideo } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { VideoNodeData } from "./interactive-mock";

function VideoNodeComponent({ data, selected }: NodeProps<VideoNodeData>) {
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card shadow-lg transition-all",
        data.isStart
          ? "border-green-400/50"
          : data.isEnding
            ? "border-amber-400/50"
            : selected
              ? "border-primary"
              : "border-border"
      )}
    >
      {/* Input handle */}
      {!data.isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!size-3 !border-2 !border-primary !bg-background"
        />
      )}

      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-xl px-3 py-2",
          data.isStart ? "bg-green-400/10" : data.isEnding ? "bg-amber-400/10" : "bg-secondary/50"
        )}
      >
        {data.isStart ? (
          <IconFlag className="size-3.5 text-green-400" />
        ) : data.isEnding ? (
          <IconFlagFilled className="size-3.5 text-amber-400" />
        ) : (
          <IconPlayerPlay className="size-3.5 text-primary" />
        )}
        <span className="flex-1 truncate text-xs font-semibold text-foreground">{data.label}</span>
        <span className="text-[10px] text-muted-foreground">{data.duration}s</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {/* Video preview placeholder */}
        <div className="mb-2 flex aspect-video items-center justify-center rounded-lg bg-secondary/80">
          {data.videoUrl ? (
            <span className="text-[10px] text-green-400">已上传</span>
          ) : (
            <IconVideo className="size-5 text-muted-foreground/30" />
          )}
        </div>

        <p className="mb-2 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
          {data.description}
        </p>

        {/* Choices */}
        {data.choices.length > 0 && (
          <div className="space-y-1 border-t border-border pt-2">
            {data.choices.map((choice, i) => (
              <div
                key={choice.id}
                className="flex items-center gap-1.5 rounded bg-primary/5 px-2 py-1 text-[10px]"
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[8px] font-bold text-primary">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="truncate text-foreground">{choice.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Output handle */}
      {!data.isEnding && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!size-3 !border-2 !border-primary !bg-background"
        />
      )}
    </div>
  );
}

export const VideoNodeMemo = memo(VideoNodeComponent);
