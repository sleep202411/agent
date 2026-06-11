export type CanvasProject = {
  id: string;
  name: string;
  updatedAt: string;
};

/** Placeholder until canvas projects are persisted to a backend. */
export const CANVAS_PROJECTS: CanvasProject[] = [
  { id: "untitled", name: "Untitled canvas", updatedAt: "Edited just now" },
];

export function getCanvasProject(id: string): CanvasProject | undefined {
  return CANVAS_PROJECTS.find((project) => project.id === id);
}
