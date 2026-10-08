import type { ComponentType, Ref } from "react";
import type {
  ExperienceUICopy,
  ExperienceAppearance,
  GameUIArtifact,
} from "@repo/shared/experience-runtime";
import type { ExperiencePlayerPlaybackCopy } from "./experience-player-copy";
import type { ExperienceViewerPauseReason } from "./experience-playback-holds";
import type { ExperiencePlaybackTransportControlsProps } from "./experience-transport-controls";
import type { GameSession } from "@repo/game-sdk";

/** A complete home screen can arrange its own UI and invoke bounded game actions. */
export interface ExperienceMainMenuUIProps {
  readonly title: string;
  readonly locale?: string;
  readonly summary?: string;
  readonly eyebrow?: string;
  readonly session: GameSession;
  readonly copy: {
    readonly start: string;
    readonly starting: string;
    readonly loading: string;
    readonly continue: string;
    readonly restart: string;
    readonly map: string;
    readonly returnMenu?: string;
  };
}

/** Components receive view data and bounded actions, never the engine/controller. */
export interface ExperienceStartUIProps {
  readonly title: string;
  readonly summary?: string;
  readonly eyebrow?: string;
  readonly state: "loading" | "ready" | "starting";
  readonly actionLabel: string;
  readonly onStart: () => void;
}
export interface ExperiencePlaybackUIProps extends ExperiencePlaybackTransportControlsProps {
  readonly paused: boolean;
  readonly pauseLabel: string;
  readonly onTogglePause: () => void;
}
export interface ExperienceChoiceItem {
  readonly id: string;
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly price?: string;
}
export interface ExperienceChoicesUIProps {
  readonly prompt?: string;
  readonly choices: readonly ExperienceChoiceItem[];
  readonly emptyLabel: string;
  readonly disabled: boolean;
  readonly onChoose: (choiceId: string) => void;
}
export interface ExperiencePauseUIProps {
  /** Attach to the Resume button to preserve focus entry and restoration. */
  readonly resumeRef: Ref<HTMLButtonElement>;
  readonly reason: ExperienceViewerPauseReason;
  readonly copy: ExperiencePlayerPlaybackCopy;
  readonly restartLabel: string;
  readonly onResume: () => void;
  readonly onRestart: () => void;
}

/** Trusted application components only. Generated styling uses the shared JSON schema. */
export interface ExperiencePlayerUI {
  readonly apiVersion: 1;
  /** Live authoring override; published playback uses the manifest snapshot. */
  readonly appearance?: ExperienceAppearance;
  /** `null` restores the native menu in a live draft; releases use their artifact snapshot. */
  readonly gameUi?: GameUIArtifact | null;
  readonly copy?: ExperienceUICopy;
  readonly mainMenu?: ComponentType<ExperienceMainMenuUIProps>;
  /** Prefer mainMenu for a complete home screen with shared game actions. */
  readonly start?: ComponentType<ExperienceStartUIProps>;
  readonly playback?: ComponentType<ExperiencePlaybackUIProps>;
  readonly choices?: ComponentType<ExperienceChoicesUIProps>;
  readonly pause?: ComponentType<ExperiencePauseUIProps>;
}
