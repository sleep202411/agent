import type { ComponentType } from "react";
import { IconArtboard, IconFileText, type Icon } from "@tabler/icons-react";
import { CanvasEditor } from "./canvas-editor";
import { BriefEditor } from "./brief-editor";

/**
 * The mode registry — the single wiring point for multi-mode. Each entry maps a
 * server document `type` + URL `slug` to its editor. The shell, router, and
 * switcher are all generic over this; adding a mode (storyboard / timeline / …)
 * is a new entry + an editor, with zero shell/routing changes.
 *
 * Only modes with a REAL editor are registered — the switcher never shows a
 * faked or unbuilt tab.
 */
export interface StudioMode {
  /** Server document type (matches the DocumentType enum). */
  type: string;
  /** URL segment under /project/[projectId]/[slug]. */
  slug: string;
  label: string;
  Icon: Icon;
  Editor: ComponentType;
}

export const MODES: Record<string, StudioMode> = {
  canvas: {
    type: "canvas",
    slug: "canvas",
    label: "Canvas",
    Icon: IconArtboard,
    Editor: CanvasEditor,
  },
  brief: {
    type: "brief",
    slug: "brief",
    label: "Brief",
    Icon: IconFileText,
    Editor: BriefEditor,
  },
};

/** Display order in the mode switcher. */
export const MODE_ORDER: readonly string[] = ["canvas", "brief"];

/** The mode a bare /project/[projectId] redirects to. */
export const DEFAULT_MODE = "canvas";

export function getMode(slug: string): StudioMode | undefined {
  return MODES[slug];
}
