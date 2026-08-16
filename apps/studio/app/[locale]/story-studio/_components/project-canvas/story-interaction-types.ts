export interface NormalizedHotspotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StoryInteractionActionDraft =
  | { kind: "continue" }
  | { kind: "seek"; timeSeconds: number }
  | { kind: "goto"; targetNodeId: string };

export type StoryInteractionTriggerDraft =
  | { kind: "tap" }
  | { kind: "swipe"; direction: "up" | "down" | "left" | "right" }
  | {
      kind: "press-hold";
      durationSeconds: number;
      /**
       * Timeline-control charge: the clip pauses while the input window is
       * open and only advances while the pointer is held, so playback
       * position is the charge progress.
       */
      controlTimeline: boolean;
    };

export type StoryInteractionOutcomesDraft = {
  success: StoryInteractionActionDraft;
  failure?: StoryInteractionActionDraft;
  timeout?: StoryInteractionActionDraft;
};

export interface StoryInteractionDraft {
  id: string;
  label: string;
  rect: NormalizedHotspotRect;
  startSeconds: number;
  endSeconds: number;
  /**
   * Safe branch frame in seconds; null falls back to the input window end so
   * the branch cut lands when the window closes (legacy behavior).
   */
  branchAtSeconds: number | null;
  trigger: StoryInteractionTriggerDraft;
  outcomes: StoryInteractionOutcomesDraft;
}
