"use client";

import { Fragment, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Controls } from "@xyflow/react";
import { IconHandMove, IconPointer } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { CanvasTool } from "./canvas-interaction-policy";
import { useCanvasTool } from "./canvas-tool-context";

type CanvasControlsProps = Omit<ComponentProps<typeof Controls>, "showInteractive">;

type CanvasToolButtonsProps = {
  buttonClassName?: string;
  activeButtonClassName?: string;
  iconClassName?: string;
  renderTooltip?: (label: string, button: ReactElement) => ReactNode;
};

const CANVAS_TOOLS = [
  { tool: "select", labelKey: "selectTool", Icon: IconPointer },
  { tool: "pan", labelKey: "panTool", Icon: IconHandMove },
] as const satisfies ReadonlyArray<{
  tool: CanvasTool;
  labelKey: "selectTool" | "panTool";
  Icon: typeof IconPointer;
}>;

/** Shared tool semantics for every canvas toolbar, independent of its visual shell. */
export function CanvasToolButtons({
  buttonClassName,
  activeButtonClassName,
  iconClassName,
  renderTooltip,
}: CanvasToolButtonsProps) {
  const t = useTranslations("canvasControls");
  const { activeTool, setActiveTool } = useCanvasTool();

  return CANVAS_TOOLS.map(({ tool, labelKey, Icon }) => {
    const label = t(labelKey);
    const active = activeTool === tool;
    const button = (
      <button
        type="button"
        className={cn(buttonClassName, active && activeButtonClassName)}
        aria-label={label}
        aria-pressed={active}
        title={renderTooltip ? undefined : label}
        onClick={() => setActiveTool(tool)}
      >
        <Icon className={cn("canvas-tool-icon size-4", iconClassName)} stroke={1.8} />
      </button>
    );

    return <Fragment key={tool}>{renderTooltip ? renderTooltip(label, button) : button}</Fragment>;
  });
}

/** React Flow controls extended with honest, persistent Select and Hand tools. */
export function CanvasControls({ children, className, ...props }: CanvasControlsProps) {
  return (
    <Controls {...props} className={cn("canvas-tool-controls", className)} showInteractive={false}>
      {children}
      <CanvasToolButtons
        buttonClassName="react-flow__controls-button canvas-tool-button"
        activeButtonClassName="canvas-tool-button-active"
      />
    </Controls>
  );
}
