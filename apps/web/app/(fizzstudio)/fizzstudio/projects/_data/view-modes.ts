import { IconLayoutGrid, IconLayoutKanban, IconTimeline, type Icon } from "@tabler/icons-react";

/**
 * The three view modes a storyboard renders as. They are UI views over the
 * same underlying shot data — NOT separate documents. Switching modes never
 * changes the data, only how it's presented (the user's architecture).
 */
export type ViewMode = "storyboard" | "timeline" | "canvas";

export interface ViewModeMeta {
  mode: ViewMode;
  /** i18n key under `fizzStudio` */
  labelKey: string;
  Icon: Icon;
}

export const VIEW_MODES: ViewModeMeta[] = [
  { mode: "storyboard", labelKey: "viewStoryboard", Icon: IconLayoutGrid },
  { mode: "timeline", labelKey: "viewTimeline", Icon: IconTimeline },
  { mode: "canvas", labelKey: "viewCanvas", Icon: IconLayoutKanban },
];
