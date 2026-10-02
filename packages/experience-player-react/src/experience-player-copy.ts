export interface ExperiencePlayerVideoCopy {
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  volume: string;
  enterFullscreen: string;
  exitFullscreen: string;
  seekForward: string;
  seekBackward: string;
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
}
