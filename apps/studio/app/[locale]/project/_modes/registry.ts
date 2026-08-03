import type { ComponentType } from "react";
import { IconArtboard, IconFileText, IconTable, type Icon } from "@tabler/icons-react";
import { CanvasEditor } from "./canvas-editor";
import { BriefEditor } from "./brief-editor";
import { StoryboardEditor } from "./storyboard-editor";

/**
 * The mode registry — the single wiring point for multi-mode. Each entry maps a
 * URL `slug` to its editor and the server document that editor opens. The
 * shell, router, and switcher are all generic over this; adding a mode
 * (timeline / …) is a new entry + an editor, with zero shell/routing changes.
 *
 * A mode is NOT the same thing as a document: `documentType` is what the editor
 * opens, and several modes may open the SAME document — storyboard and canvas
 * are two renderings of one canvas document. (Editors resolve it themselves via
 * `useModeDocument`; this field documents the mapping, it does not drive it.)
 *
 * Only modes with a REAL editor are registered — the switcher never shows a
 * faked or unbuilt tab.
 */
export interface StudioMode {
  /** Server document type this mode's editor opens (matches the DocumentType enum). */
  documentType: string;
  /** URL segment under /project/[projectId]/[slug]. */
  slug: string;
  labelKey: "modes.canvas" | "modes.storyboard" | "modes.brief";
  Icon: Icon;
  Editor: ComponentType;
}

export const MODES: Record<string, StudioMode> = {
  canvas: {
    documentType: "canvas",
    slug: "canvas",
    labelKey: "modes.canvas",
    Icon: IconArtboard,
    Editor: CanvasEditor,
  },
  storyboard: {
    // The board's document, projected as shot rows — never its own document.
    documentType: "canvas",
    slug: "storyboard",
    labelKey: "modes.storyboard",
    Icon: IconTable,
    Editor: StoryboardEditor,
  },
  brief: {
    documentType: "brief",
    slug: "brief",
    labelKey: "modes.brief",
    Icon: IconFileText,
    Editor: BriefEditor,
  },
};

/** Display order in the mode switcher. */
export const MODE_ORDER: readonly string[] = ["canvas", "storyboard", "brief"];

/** The mode a bare /project/[projectId] redirects to. */
export const DEFAULT_MODE = "canvas";

export function getMode(slug: string): StudioMode | undefined {
  return MODES[slug];
}
