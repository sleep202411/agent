"use client";

import { BaseEdge, getBezierPath, useStore, type EdgeProps } from "@xyflow/react";
import { colorForType, outputTypeForNodeType } from "./port-colors";

/**
 * Edge tinted by the SOURCE node's output-type color, fading toward neutral at
 * the (multi-type) target input — so a connection visually states the type it
 * carries (imagine.art pattern). Handles use generic "input"/"output" ids, so
 * the type is read from the source NODE's type via the store. `userSpaceOnUse`
 * ties the gradient to the path so it stays correct as nodes move.
 */
export function GradientEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const sourceType = useStore((s) => s.nodeLookup.get(source)?.type);
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const gradientId = `edge-grad-${id}`;
  const from = colorForType(outputTypeForNodeType(sourceType));
  const to = "rgb(255 255 255 / 0.4)";

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: selected ? 2.5 : 1.75,
          opacity: selected ? 1 : 0.9,
        }}
      />
    </>
  );
}
