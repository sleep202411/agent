"use client";

import { memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import { type Node, type NodeProps } from "@xyflow/react";
import { IconLayoutList, IconPhoto, IconTable } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useRouter } from "@/i18n/navigation";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { useOptionalProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useOptionalProjectSections } from "@/app/[locale]/project/_components/project-sections-context";
import { useTextDraft } from "@/lib/use-text-draft";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";
import {
  SHOT_NODE_TYPE,
  shotReferences,
  sortedShots,
  type ShotNodeData,
} from "@/lib/canvas-authoring/shot-node";
import { useShotOptionLabel } from "@/lib/canvas-authoring/use-shot-labels";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { PortPlus } from "./ports";

export type ShotNodeType = Node<ShotNodeData & Record<string, unknown>, typeof SHOT_NODE_TYPE>;

/**
 * A storyboard shot as a film frame on the canvas.
 *
 * The card shows what the shot IS (its number, picture, framing, line); what it
 * takes to make the picture lives on the generation cards wired into its single
 * input — a shot consumes media, it never sources it, which is also why it has
 * no output handle. The same node renders as a row in the storyboard mode.
 */
function ShotNodeComponent({ id, data, selected }: NodeProps<ShotNodeType>) {
  const t = useTranslations("storyboard");
  const { nodes, patchNodeData, canEdit } = useCanvasGraphContext();
  const project = useOptionalProjectContext();
  const projectSections = useOptionalProjectSections();
  const router = useRouter();

  // The shot number is a projection of the ordered shot list, never stored —
  // inserting a shot renumbers the board with zero writes.
  const index = useMemo(() => sortedShots(nodes).findIndex((node) => node.id === id), [nodes, id]);
  const pictures = useMemo(() => shotReferences(data), [data]);
  // Frame then clip, so the last one is the most finished form of this shot —
  // once it moves, the card shows it moving. The count badge says a still is
  // behind it; the table cell shows both side by side.
  const picture = pictures.at(-1);
  const dialogue = useTextDraft(data.dialogue ?? "", (next) =>
    patchNodeData(id, { dialogue: next || undefined })
  );

  const optionLabel = useShotOptionLabel();
  const chips = [
    optionLabel("size", data.shotSize),
    optionLabel("angle", data.perspective),
    optionLabel("movement", data.movement),
    typeof data.durationSeconds === "number"
      ? t("cell.durationValue", { seconds: data.durationSeconds })
      : null,
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <div className="relative" style={{ width: canvasNodeGeometry({ type: SHOT_NODE_TYPE }).width }}>
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
        {project ? (
          <ToolbarButton
            label={t("node.openInStoryboard")}
            onClick={() =>
              projectSections?.activeSection &&
              router.push(
                `/project/${project.projectId}/storyboard?section=${encodeURIComponent(projectSections.activeSection.id)}&row=${encodeURIComponent(id)}`
              )
            }
          >
            <IconTable className="size-4" stroke={1.8} />
          </ToolbarButton>
        ) : null}
      </CanvasNodeToolbar>

      <div className="flex items-center gap-1.5 rounded px-1 pb-1.5 text-xs text-white/80">
        <IconLayoutList className="size-3.5 shrink-0" stroke={1.8} />
        <span className="truncate">
          {data.label?.trim() || t("node.title", { index: index >= 0 ? index + 1 : 1 })}
        </span>
      </div>

      <div className={cn("overflow-hidden rounded-xl bg-card", selected && "ring-2 ring-ring")}>
        <div className="relative flex aspect-video items-center justify-center bg-white/[0.04]">
          {picture ? (
            picture.kind === "video" ? (
              <video
                src={picture.url}
                muted
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={picture.url}
                alt={picture.name ?? t("node.pictureAlt")}
                draggable={false}
                className="size-full object-cover select-none"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-4 text-center">
              <IconPhoto className="size-6 text-white/25" stroke={1.5} />
              <p className="text-[11px] leading-tight text-white/35">{t("node.emptyHint")}</p>
            </div>
          )}
          {pictures.length > 1 ? (
            <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80 tabular-nums">
              {pictures.length}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 p-2.5">
          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-white/65"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            value={dialogue.value}
            onChange={(event) => dialogue.onChange(event.target.value)}
            onBlur={dialogue.flush}
            placeholder={canEdit ? t("cell.dialoguePlaceholder") : ""}
            rows={2}
            readOnly={!canEdit}
            data-canvas-scroll-owner="y"
            className="nodrag nowheel block w-full resize-none bg-transparent text-xs leading-relaxed text-white/75 outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Consumer-only: one input, no output — nothing meaningful flows OUT of
          a shot, so "shot → shot" wires can't be drawn in the first place. */}
      <PortPlus type="target" id="input" side="left" />
    </div>
  );
}

export const ShotNode = memo(ShotNodeComponent);
