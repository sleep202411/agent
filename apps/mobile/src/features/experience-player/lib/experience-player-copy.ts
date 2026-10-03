export interface ExperiencePlayerCopy {
  invalidManifest: string;
  manifestRoot: string;
  interactiveFilm: string;
  starting: string;
  start: string;
  pause: string;
  resume: string;
  paused: string;
  loadingMedia: string;
  endingEyebrow: string;
  unknownEnding: string;
  playAgain: string;
  runtimeError: string;
  restart: string;
  noVisibleChoices: string;
  continue: string;
  emptySequence: string;
  mediaError: (assetId: string) => string;
}
