/**
 * The storyboard's column track — ONE definition shared by the header and every
 * row.
 *
 * Virtualized rows are absolutely positioned, so real table layout (`colgroup` +
 * `table-fixed`) no longer aligns them: the browser can only size columns from
 * cells it lays out together, and a virtual window never contains the whole
 * column. Header and rows therefore run on the same CSS grid track list, which
 * also makes column work (resize, pin, hide) a change to this array rather than
 * a hunt through JSX.
 */
export const STORYBOARD_COLUMNS = [
  { key: "number", track: "3.25rem" },
  { key: "frame", track: "10rem" },
  { key: "clip", track: "10rem" },
  { key: "size", track: "7rem" },
  { key: "angle", track: "7rem" },
  { key: "movement", track: "7rem" },
  { key: "duration", track: "5rem" },
  { key: "dialogue", track: "minmax(12rem, 1fr)" },
  { key: "notes", track: "16rem" },
  { key: "id", track: "6rem" },
  { key: "actions", track: "3rem" },
] as const;

export type StoryboardColumnKey = (typeof STORYBOARD_COLUMNS)[number]["key"];

/** Columns that carry a visible header label (`actions` is icon-only). */
export const STORYBOARD_LABELLED_COLUMNS = STORYBOARD_COLUMNS.filter(
  (column) => column.key !== "actions"
);

export const STORYBOARD_GRID_TEMPLATE = STORYBOARD_COLUMNS.map((column) => column.track).join(" ");

/**
 * Row rules only — horizontal hairlines, no column lines and no box. That is
 * DESIGN.md §4's one sanctioned "border" (a separator between rows), and it is
 * enough: alignment does the vertical work. Header and body share this so the
 * two can never drift apart.
 */
export const STORYBOARD_ROW_RULE = "border-white/[0.09]";

/**
 * Height the virtualizer reserves for a row it has not measured yet — one 16:9
 * thumbnail plus padding. Real heights are measured on mount (a wrapped line of
 * dialogue makes a row taller), so this only has to be close.
 */
export const STORYBOARD_ESTIMATED_ROW_HEIGHT = 100;

/** Rows kept mounted beyond the viewport, so scrolling doesn't flash blanks. */
export const STORYBOARD_OVERSCAN = 8;
