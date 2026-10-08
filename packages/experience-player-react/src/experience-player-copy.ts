export interface ExperiencePlayerVideoCopy {
  unmute: string;
}

export interface ExperienceJourneyMapCopy {
  open: string;
  title: string;
  description: string;
  close: string;
  current: string;
  explored: string;
  unexplored: string;
  unexploredHint: string;
  replay: string;
  replaying: string;
  replayHint: string;
  replayUnavailable: string;
  empty: string;
  canvasLabel: string;
  centerCurrent: string;
  sceneLabel: (number: number) => string;
  endingLabel: string;
  truncated: string;
  thumbnailUnavailable: string;
}

export interface ExperiencePlayerTransportCopy {
  controlsLabel: string;
  rewind10: string;
  forward10: string;
  progressLabel: string;
  speedLabel: string;
  watchedOnlyHint: string;
  interactionBlocked: string;
}

/** The film frame's own playback controls: the pause toggle and the paused frame. */
export interface ExperiencePlayerPlaybackCopy {
  /** The toggle while the film plays. */
  pause: string;
  /** The toggle, and the paused frame, while the film is paused. */
  resume: string;
  /** Announced to assistive tech while the film is paused. */
  paused: string;
  /** The paused frame's button once the device would not play without a tap. */
  continuePlaying: string;
  /** The line under that button: why it is there. */
  interrupted: string;
  transport: ExperiencePlayerTransportCopy;
}

export interface ExperiencePlayerCopy {
  invalidManifest: string;
  manifestRoot: string;
  interactiveFilm: string;
  starting: string;
  start: string;
  mainMenu: string;
  returnToMenu: string;
  continueGame: string;
  codeMenu: { failed: string; retry: string; restore: string };
  endingEyebrow: string;
  unknownEnding: (endingId: string) => string;
  playAgain: string;
  runtimeError: string;
  restart: string;
  retryReport?: string;
  mediaError: (assetId: string) => string;
  videoLabel: (rendererInstanceId: string) => string;
  /**
   * Shown in place of a video scene whose footage is not attached yet. Only a
   * preview Build can contain one, so a viewer of a released experience never
   * sees this.
   */
  emptySequence: string;
  /** Start button label while the entry clip is being prepared. */
  loadingMedia: string;
  noVisibleChoices: string;
  continue: string;
  regionLabel: string;
  video: ExperiencePlayerVideoCopy;
  playback: ExperiencePlayerPlaybackCopy;
  journeyMap: ExperienceJourneyMapCopy;
}
