"use client";

import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import {
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPlus,
  IconVideo,
  IconUnlink,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { cn } from "@/lib/utils";
import { useStoryboard } from "./use-storyboard";
import { ShotThumbnail } from "./shot-thumbnail";
import { StoryboardExport } from "./storyboard-export";
import { StoryboardPlayback } from "./storyboard-playback";

const SHOT_MIME = "application/x-fizz-storyboard-shot";
type Gesture = { nodeId: string; pointerId: number; x: number; y: number; moved: boolean };

/** Canvas placement and storyboard placement use distinct gestures. While armed,
 * capture a media-node drag before React Flow can move its saved canvas position. */
export function CanvasStoryboard({ children }: { children: ReactNode }) {
  const t = useTranslations("storyboard.drag");
  const graph = useCanvasGraphContext();
  const { rows, canvasSources, canEdit, attachSource, detachPicture, insertShot, moveShotToIndex } =
    useStoryboard();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; label: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const sources = canvasSources.filter((source) => source.kind === "video");
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
    if (!armed || !canEdit || event.button !== 0 || !event.isPrimary) return;
    const source = sourceAt(event.target);
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    graph.selectNodes([source.nodeId]);
    gesture.current = {
      nodeId: source.nodeId,
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
      if (attachSource(shotId, current.nodeId)) setAnnouncement(t("placed"));
    }
    reset();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
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
      <div className="relative min-h-0 flex-1">
        {children}
        {armed && canEdit && (
          <div className="pointer-events-none absolute inset-x-4 top-24 z-20 flex justify-center">
            <p
              className="max-w-xl rounded-full bg-primary px-4 py-2 text-center text-xs font-medium text-primary-foreground"
              role="status"
            >
              {t("activeMode")}
            </p>
          </div>
        )}
        <div className="absolute right-4 bottom-4 z-20 flex gap-2">
          {canEdit && (
            <Button
              size="sm"
              variant={armed ? "default" : "secondary"}
              aria-pressed={armed}
              onClick={() => {
                reset();
                setArmed(!armed);
                setOpen(true);
              }}
            >
              {t("mode")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={open}
            onClick={() => {
              reset();
              setOpen(!open);
              if (open) setArmed(false);
            }}
          >
            {t("title")}
          </Button>
        </div>
      </div>
      {open && (
        <section className="z-20 shrink-0 bg-card" aria-label={t("title")}>
          <header className="flex flex-wrap items-center gap-2 px-4 py-2">
            <h2 className="text-sm font-medium">{t("title")}</h2>
            <p className="mr-auto text-xs text-muted-foreground">
              {armed ? t("instructions") : t("reorder")}
            </p>
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
              "flex gap-3 overflow-auto px-4 pb-3",
              expanded ? "max-h-[45dvh] flex-wrap" : "max-h-52"
            )}
          >
            {!rows.length && <p className="py-6 text-sm text-muted-foreground">{t("empty")}</p>}
            {rows.map((row, index) => (
              <div
                key={row.id}
                data-storyboard-shot={row.id}
                className={cn(
                  "w-40 shrink-0 rounded-lg bg-muted p-2",
                  hovered === row.id && "outline-2 outline-primary"
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
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>{t("shot", { number: index + 1 })}</span>
                  {canEdit && row.pictures.some((picture) => picture.kind === "video") && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("removeVideo", { number: index + 1 })}
                      title={t("removeVideo", { number: index + 1 })}
                      onClick={() => {
                        for (const picture of row.pictures)
                          if (picture.kind === "video") detachPicture(row.id, picture.edgeId);
                      }}
                    >
                      <IconUnlink />
                    </Button>
                  )}
                  {canEdit && (
                    <span
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SHOT_MIME, row.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setHovered(null)}
                      title={t("reorder")}
                      className="cursor-grab"
                    >
                      <IconGripVertical className="size-4" />
                    </span>
                  )}
                </div>
                <div className="flex aspect-video items-center justify-center rounded bg-background text-muted-foreground">
                  <ShotThumbnail row={row} />
                </div>
                {canEdit && (
                  <div className="mt-2 flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-w-0 flex-1 text-xs"
                      disabled={!selected}
                      onClick={() => {
                        if (selected && attachSource(row.id, selected.nodeId))
                          setAnnouncement(t("placed"));
                      }}
                    >
                      {t("placeSelected")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      aria-label={t("earlier", { number: index + 1 })}
                      onClick={() => moveShotToIndex(row.id, index - 1)}
                    >
                      ←
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={index === rows.length - 1}
                      aria-label={t("later", { number: index + 1 })}
                      onClick={() => moveShotToIndex(row.id, index + 1)}
                    >
                      →
                    </Button>
                  </div>
                )}
              </div>
            ))}
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
