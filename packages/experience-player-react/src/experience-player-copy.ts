export interface ExperiencePlayerVideoCopy {
  unmute: string;
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
}

export interface ExperiencePlayerCopy {
  invalidManifest: string;
  manifestRoot: string;
  interactiveFilm: string;
  starting: string;
  start: string;
  endingEyebrow: string;
  unknownEnding: (endingId: string) => string;
  playAgain: string;
  runtimeError: string;
  restart: string;
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
}
