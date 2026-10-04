import type { ExperienceJourneyMapCopy } from "./experience-player-copy";

/** Shared map copy for player tests; production hosts use their localized messages. */
export const journeyMapTestCopy: ExperienceJourneyMapCopy = {
  open: "Story map",
  title: "Story map",
  description: "Scenes you have explored and the routes you have taken.",
  close: "Close story map",
  current: "Current",
  explored: "Explored",
  unexplored: "Unexplored",
  unexploredHint:
    "This part of the story is unexplored. Keep playing or try other choices to discover more of the story.",
  replay: "Replay from here",
  replaying: "Returning to the scene…",
  replayHint: "Replay starts at the scene’s entry point and replaces progress after it.",
  replayUnavailable: "No saved entry point is available for this scene.",
  empty: "The story map is not available yet.",
  canvasLabel: "Scenes and story paths",
  centerCurrent: "Find current scene",
  sceneLabel: (number) => `Scene ${number}`,
  endingLabel: "Ending",
  truncated: "Some connections are omitted because this map is unusually large.",
  thumbnailUnavailable: "Scene thumbnail unavailable",
};
