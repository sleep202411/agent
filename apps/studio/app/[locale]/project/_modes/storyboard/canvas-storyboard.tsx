"use client";

import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import {
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPlus,
  IconVideo,
  IconLayoutGrid,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { cn } from "@/lib/utils";
import { useStoryboard } from "./use-storyboard";
import { ShotThumbnail } from "./shot-thumbnail";
import { StoryboardExport } from "./storyboard-export";
import { StoryboardPlayback } from "./storyboard-playback";

const SHOT_MIME = "application/x-fizz-storyboard-shot";
type Gesture = {
  nodeId: string;
  shot?: boolean;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
};

/** Canvas placement and storyboard placement use distinct gestures. While armed,
 * capture a media-node drag before React Flow can move its saved canvas position. */
export function CanvasStoryboard({ children }: { children: (control: ReactNode) => ReactNode }) {
  const t = useTranslations("storyboard.drag");
  const graph = useCanvasGraphContext();
  const { rows, canvasSources, canEdit, attachSource, deleteShot, insertShot, moveShotToIndex } =
    useStoryboard();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; label: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const sources = canvasSources.filter(
    (source) => source.kind === "video" || source.kind === "image"
  );
  const selected = sources.find((source) =>
    graph.nodes.some((node) => node.id === source.nodeId && node.selected)
  );
  const reset = () => {
    gesture.current = null;
    setPreview(null);
    setHovered(null);
  };
  const sourceAt = (target: EventTarget | null) => {
    const id =
      target instanceof Element
        ? target.closest(".react-flow__node")?.getAttribute("data-id")
        : null;
    return sources.find((source) => source.nodeId === id);
  };
  const targetAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-storyboard-shot]")?.dataset
      .storyboardShot ?? null;
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!open || !canEdit || event.button !== 0 || !event.isPrimary) return;
    const handle =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-reorder-shot]")
        : null;
    const source = armed ? sourceAt(event.target) : null;
    if (!source && !handle) return;
    event.preventDefault();
    event.stopPropagation();
    // Do not select the node: selection opens the generation composer over the drop targets.
    gesture.current = {
      nodeId: handle?.dataset.reorderShot ?? source!.nodeId,
      shot: Boolean(handle),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6;
    if (!current.moved) return;
    setPreview({
      x: event.clientX,
      y: event.clientY,
      label: sources.find((source) => source.nodeId === current.nodeId)?.label ?? t("video"),
    });
    setHovered(targetAt(event.clientX, event.clientY));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const shotId = targetAt(event.clientX, event.clientY);
    if (canEdit && current.moved && shotId && rows.some((row) => row.id === shotId)) {
      if (current.shot)
        moveShotToIndex(
          current.nodeId,
          rows.findIndex((row) => row.id === shotId)
        );
      else if (attachSource(shotId, current.nodeId)) setAnnouncement(t("placed"));
    }
    reset();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const toggle = (
    <Button
      size="icon"
      variant="secondary"
      className={cn("shrink-0", open && "bg-accent text-foreground")}
      aria-label={t("title")}
      title={t("title")}
      aria-expanded={open}
      onClick={() => {
        reset();
        if (!open) graph.selectNodes([]);
        setOpen(!open);
        setArmed(!open);
        if (!open && canEdit && !rows.length) insertShot(0);
      }}
    >
      <IconLayoutGrid aria-hidden="true" />
    </Button>
  );
  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragStartCapture={(event) => {
        if (armed && sourceAt(event.target)) event.preventDefault();
      }}
      onPointerDownCapture={start}
      onPointerMoveCapture={move}
      onPointerUpCapture={finish}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
      onClickCapture={(event) => {
        if (armed && sourceAt(event.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          reset();
        }
      }}
    >
      <div className="relative min-h-0 flex-1">{children(toggle)}</div>
      {open && (
        <section
          className="z-20 min-w-0 shrink-0 bg-card"
          aria-label={t("title")}
          style={{
            paddingLeft: "var(--project-canvas-left-overlay-inset, 0px)",
            paddingRight: "var(--project-canvas-right-overlay-inset, 0px)",
          }}
        >
          <header className="flex flex-wrap items-center gap-2 px-4 py-2">
            <h2 className="mr-auto text-sm font-medium">
              {t("title")} <span className="text-muted-foreground">{rows.length}</span>
            </h2>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={armed}
                onClick={() => {
                  reset();
                  setArmed(!armed);
                }}
              >
                {t("mode")}
              </Button>
            )}
            <StoryboardPlayback rows={rows} />
            <StoryboardExport disabled={!rows.length} />
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => insertShot(rows.length)}>
                <IconPlus />
                {t("add")}
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={expanded ? t("collapse") : t("expand")}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <IconChevronDown /> : <IconChevronUp />}
            </Button>
          </header>
          <div
            className={cn(
              "grid grid-cols-2 items-start gap-3 overflow-y-auto px-4 pb-3 sm:grid-cols-3 lg:grid-cols-6",
              expanded ? "max-h-[45dvh]" : "max-h-64"
            )}
          >
            {rows.map((row, index) => (
              <div
                key={row.id}
                data-storyboard-shot={row.id}
                className={cn(
                  "min-w-0 rounded-lg",
                  hovered === row.id && "outline-2 outline-foreground"
                )}
                onDragOver={(event) => {
                  if (canEdit && event.dataTransfer.types.includes(SHOT_MIME)) {
                    event.preventDefault();
                    setHovered(row.id);
                  }
                }}
                onDragLeave={() => setHovered(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData(SHOT_MIME);
                  if (canEdit && rows.some((item) => item.id === id)) moveShotToIndex(id, index);
                  setHovered(null);
                }}
              >
                <div className="mb-2 flex h-8 items-center justify-between text-xs">
                  <span>{t("shot", { number: index + 1 })}</span>
                  {canEdit && (
                    <div className="flex items-center">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("removeShot", { number: index + 1 })}
                        onClick={() => deleteShot(row.id)}
                      >
                        <IconTrash />
                      </Button>
                      <button
                        type="button"
                        data-reorder-shot={row.id}
                        aria-label={t("reorder")}
                        title={t("reorder")}
                        className="touch-none cursor-grab p-2"
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          moveShotToIndex(row.id, index + (event.key === "ArrowLeft" ? -1 : 1));
                        }}
                      >
                        <IconGripVertical className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground"
                  disabled={!canEdit || !selected}
                  aria-label={t("placeSelected")}
                  onClick={() => {
                    if (selected && attachSource(row.id, selected.nodeId))
                      setAnnouncement(t("placed"));
                  }}
                >
                  <ShotThumbnail row={row} />
                </button>
              </div>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={() => insertShot(rows.length)}
                className="mt-10 flex aspect-video items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 text-xs text-muted-foreground"
              >
                <IconPlus className="size-4" />
                {t("newShot")}
              </button>
            )}
          </div>
        </section>
      )}
      {preview && (
        <div
          className="pointer-events-none fixed z-[100] max-w-56 truncate rounded-lg bg-popover px-3 py-2 text-xs shadow-lg"
          style={{ left: preview.x + 12, top: preview.y + 12 }}
        >
          <IconVideo className="mr-2 inline size-4" />
          {preview.label}
        </div>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
