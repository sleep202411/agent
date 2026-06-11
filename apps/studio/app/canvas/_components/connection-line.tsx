"use client";

import { getBezierPath, type ConnectionLineComponentProps } from "@xyflow/react";
import { handleColor } from "./port-colors";

/**
 * The in-progress drag line: a gradient from the source port color (solid)
 * fading toward the cursor — matches imagine.art's "live wire" look.
 */
export function CanvasConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  fromHandle,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  const color = handleColor(fromHandle?.id);

  return (
    <g>
      <defs>
        <linearGradient
          id="canvas-connection-grad"
          gradientUnits="userSpaceOnUse"
          x1={fromX}
          y1={fromY}
          x2={toX}
          y2={toY}
        >
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="55%" stopColor={color} stopOpacity={0.5} />
          <stop offset="100%" stopColor={color} stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="url(#canvas-connection-grad)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );
}
