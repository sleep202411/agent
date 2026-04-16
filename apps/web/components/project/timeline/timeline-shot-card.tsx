import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  IconDots,
  IconLoader2,
  IconMicrophone2,
  IconPhoto,
  IconPhotoAi,
  IconPlus,
  IconVideo,
  IconVideoPlus,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatDurationLabel,
  snapTimeToTick,
  MIN_DURATION,
  MAX_DURATION,
  type TimelineShot,
  type TimelineMenuAction,
} from "./timeline-types";

interface TimelineShotCardProps {
  shot: TimelineShot;
  width: number;
  selected: boolean;
  playing: boolean;
  canLipSync: boolean;
  pxPerSecond: number;
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onAction: (action: TimelineMenuAction) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onResize: (nextDuration: number) => void;
}

export function TimelineShotCard({
  shot,
  width,
  selected,
  playing,
  canLipSync,
  pxPerSecond,
  onClick,
  onDoubleClick,
  onAction,
  onDragStart,
  onDragOver,
  onDragEnd,
  onResize,
}: TimelineShotCardProps) {
  const ts = useTranslations("storyboard");
  const tc = useTranslations("common");
  const tt = useTranslations("timeline");
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [currentWidth, setCurrentWidth] = useState(width);
  const [lastLoadedSrc, setLastLoadedSrc] = useState("");
  const [lastErrorSrc, setLastErrorSrc] = useState("");
  const currentSrc = shot.thumbnailUrl;
  const imageError = Boolean(currentSrc) && lastErrorSrc === currentSrc;
  const imageLoading = Boolean(currentSrc) && !imageError && lastLoadedSrc !== currentSrc;
  const displayWidth = isResizing ? currentWidth : width;

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-timeline-interactive='true']")) {
        return;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const handleMouseMove = (nextEvent: MouseEvent) => {
        const deltaX = Math.abs(nextEvent.clientX - startX);
        const deltaY = Math.abs(nextEvent.clientY - startY);
        if (!moved && (deltaX > 5 || deltaY > 5)) {
          moved = true;
          setIsDragging(true);
          onDragStart();
        }
      };

      const handleMouseUp = () => {
        if (moved) {
          onDragEnd();
        }
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onDragEnd, onDragStart]
  );

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);

      const startX = event.clientX;
      const startWidth = width;

      const handleResizeMove = (nextEvent: MouseEvent) => {
        const deltaX = nextEvent.clientX - startX;
        const nextWidth = Math.max(0, startWidth + deltaX);
        const nextDuration = Math.max(
          MIN_DURATION,
          Math.min(MAX_DURATION, nextWidth / pxPerSecond)
        );
        const snappedDuration = snapTimeToTick(nextDuration, pxPerSecond);
        setCurrentWidth(snappedDuration * pxPerSecond);
      };

      const handleResizeEnd = (nextEvent: MouseEvent) => {
        const deltaX = nextEvent.clientX - startX;
        const nextWidth = Math.max(0, startWidth + deltaX);
        const nextDuration = Math.max(
          MIN_DURATION,
          Math.min(MAX_DURATION, nextWidth / pxPerSecond)
        );
        const snappedDuration = Math.round(snapTimeToTick(nextDuration, pxPerSecond) * 10) / 10;

        setIsResizing(false);
        onResize(snappedDuration);
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
      };

      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
    },
    [onResize, pxPerSecond, width]
  );

  return (
    <div
      className={cn(
        "group/card relative flex h-full shrink-0 flex-col select-none overflow-hidden rounded border border-[#3A3A3A] bg-[#0A0A0A] transition-[border-color,box-shadow]",
        selected && "border-primary shadow-[0_0_12px_rgba(229,34,39,0.5)]",
        !selected && "hover:border-primary hover:shadow-[0_0_8px_rgba(229,34,39,0.3)]",
        isDragging && "cursor-grabbing opacity-80",
        isResizing && "border-primary transition-none",
        playing && "shadow-[0_0_12px_rgba(229,34,39,0.35)]"
      )}
      style={{ width: displayWidth }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={onDragOver}
    >
      {/* Full-bleed thumbnail */}
      {shot.thumbnailUrl && !imageError ? (
        <>
          <img
            src={shot.thumbnailUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setLastErrorSrc(currentSrc)}
            onLoad={() => {
              setLastLoadedSrc(currentSrc);
              setLastErrorSrc((prev) => (prev === currentSrc ? "" : prev));
            }}
          />
          {imageLoading ? (
            <div className="absolute inset-0 z-[1] flex items-center justify-center bg-black/70">
              <IconLoader2 className="size-5 animate-spin text-white/70" />
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-2xl font-semibold text-[#666]">
          {shot.shotNo}
        </div>
      )}

      {/* Media type icon — hides on hover */}
      <div className="absolute left-1 top-1 flex size-5.5 items-center justify-center rounded bg-black/75 text-white backdrop-blur-sm transition-opacity group-hover/card:opacity-0">
        {shot.mediaType === "video" ? (
          <IconVideo className="size-3.5" />
        ) : (
          <IconPhoto className="size-3.5" />
        )}
      </div>

      {/* Hover action buttons — auto-collapse into more menu based on card width */}
      <HoverActions
        displayWidth={displayWidth}
        canLipSync={canLipSync}
        onAction={onAction}
        ts={ts}
        tc={tc}
      />

      {/* Duration badge — bottom-right */}
      <div className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-white backdrop-blur-sm">
        {formatDurationLabel(shot.duration)}
      </div>

      {/* Shot label — bottom-left */}
      <div className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-[#9A9A9A] backdrop-blur-sm">
        {tt("shotLabel", { no: shot.shotNo })}
      </div>

      {/* Resize handle — right edge, inside card bounds */}
      <div
        data-timeline-interactive="true"
        onMouseDown={handleResizeStart}
        className={cn(
          "absolute right-0 top-0 z-20 flex h-full w-3 cursor-col-resize items-center justify-center",
          selected ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"
        )}
      >
        <div
          className={cn(
            "flex h-8 w-2 items-center justify-center rounded-sm transition-colors",
            selected
              ? "bg-primary hover:bg-[#FF3D42] active:bg-[#CC1F23]"
              : "bg-white/30 hover:bg-white/40"
          )}
        >
          <div className="flex flex-col items-center gap-0.5">
            <span className="block h-px w-0.5 rounded-full bg-white/80" />
            <span className="block h-px w-0.5 rounded-full bg-white/80" />
            <span className="block h-px w-0.5 rounded-full bg-white/80" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HoverActions (auto-collapse) ──────────────────────

const BTN_SIZE = 24; // size-5.5 ≈ 22px + 2px gap
const PADDING = 8; // right-1 padding

interface QuickAction {
  key: string;
  icon: React.ReactNode;
  label: string;
  action: TimelineMenuAction;
  highlight?: boolean;
}

function HoverActions({
  displayWidth,
  canLipSync,
  onAction,
  ts,
  tc,
}: {
  displayWidth: number;
  canLipSync: boolean;
  onAction: (action: TimelineMenuAction) => void;
  ts: (key: string) => string;
  tc: (key: string) => string;
}) {
  const allQuickActions: QuickAction[] = useMemo(() => {
    const actions: QuickAction[] = [
      {
        key: "aiImage",
        icon: <IconPhotoAi className="size-3.5" />,
        label: ts("aiImage"),
        action: "aiImage",
        highlight: true,
      },
      {
        key: "aiVideo",
        icon: <IconVideoPlus className="size-3.5" />,
        label: ts("aiVideo"),
        action: "aiVideo",
        highlight: true,
      },
    ];
    if (canLipSync) {
      actions.push({
        key: "lipSync",
        icon: <IconMicrophone2 className="size-3.5" />,
        label: ts("aiLipSync"),
        action: "lipSync",
        highlight: true,
      });
    }
    actions.push({
      key: "insert",
      icon: <IconPlus className="size-3.5" />,
      label: ts("insertBelow"),
      action: "insertAfter",
    });
    return actions;
  }, [canLipSync, ts]);

  // Always reserve space for the "more" button
  const availableWidth = displayWidth - PADDING * 2 - BTN_SIZE;
  const maxVisible = Math.max(0, Math.floor(availableWidth / BTN_SIZE));
  const visibleActions = allQuickActions.slice(0, maxVisible);
  const collapsedActions = allQuickActions.slice(maxVisible);

  return (
    <div
      data-timeline-interactive="true"
      className="absolute right-1 top-1 z-[2] flex gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100 has-[[data-state=open]]:opacity-100"
    >
      {visibleActions.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction(item.action);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            "flex size-5.5 items-center justify-center rounded bg-black/75 text-white backdrop-blur-sm transition-colors",
            item.highlight ? "hover:bg-primary/80" : "hover:bg-white/20"
          )}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex size-5.5 items-center justify-center rounded bg-black/75 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <IconDots className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44 min-w-44">
          {collapsedActions.map((item) => (
            <DropdownMenuItem key={item.key} onClick={() => onAction(item.action)}>
              {item.label}
            </DropdownMenuItem>
          ))}
          {collapsedActions.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={() => onAction("replaceImage")}>
            {ts("generateImage")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("replaceVideo")}>
            {ts("generateVideo")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAction("setDuration")}>
            {ts("shotDuration")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onAction("delete")}>
            {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
