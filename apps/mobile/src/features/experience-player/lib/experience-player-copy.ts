import type { ExperienceSeekCopy } from "../components/experience-seek-control";
import type { ExperienceSpeedCopy } from "../components/experience-speed-control";
import type { ExperienceJourneyMapCopy } from "../components/experience-journey-map";
export interface ExperiencePlayerCopy {
  seek?: ExperienceSeekCopy;
  speed?: ExperienceSpeedCopy;
  journeyMap?: ExperienceJourneyMapCopy;
  invalidManifest: string;
  unsupportedRuntime: string;
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
  retryReport?: string;
  noVisibleChoices: string;
  continue: string;
  emptySequence: string;
  mediaError: (assetId: string) => string;
}

export function createExperienceJourneyMapCopy(
  t: (key: `play.journeyMap.${keyof ExperienceJourneyMapCopy}`) => string
): ExperienceJourneyMapCopy {
  return {
    open: t("play.journeyMap.open"),
    title: t("play.journeyMap.title"),
    description: t("play.journeyMap.description"),
    close: t("play.journeyMap.close"),
    current: t("play.journeyMap.current"),
    explored: t("play.journeyMap.explored"),
    unexplored: t("play.journeyMap.unexplored"),
    unexploredHint: t("play.journeyMap.unexploredHint"),
    replay: t("play.journeyMap.replay"),
    replaying: t("play.journeyMap.replaying"),
    replayHint: t("play.journeyMap.replayHint"),
    replayUnavailable: t("play.journeyMap.replayUnavailable"),
    empty: t("play.journeyMap.empty"),
    canvasLabel: t("play.journeyMap.canvasLabel"),
    centerCurrent: t("play.journeyMap.centerCurrent"),
    endingLabel: t("play.journeyMap.endingLabel"),
    truncated: t("play.journeyMap.truncated"),
    zoomIn: t("play.journeyMap.zoomIn"),
    zoomOut: t("play.journeyMap.zoomOut"),
    sceneLabel: (number) => t("play.journeyMap.sceneLabel").replace("{number}", String(number)),
  };
}
