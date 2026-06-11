"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { handleColor } from "./port-colors";

/**
 * Edge whose stroke is a linear gradient interpolating between the source
 * port color and the target port color — so a connection visually states the
 * types it bridges (imagine.art pattern). `userSpaceOnUse` ties the gradient
 * to the actual path coordinates so it stays correct as nodes move.
 */
export function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  selected,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const gradientId = `edge-grad-${id}`;
  const from = handleColor(sourceHandleId);
  const to = handleColor(targetHandleId);

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
