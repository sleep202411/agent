import type {
  WorldModelProviderKey,
  WorldSessionConnection,
  WorldStreamStatus,
} from "@repo/shared/world-model-protocol";

export type WorldTravelAction =
  | "start"
  | "move"
  | "instruct"
  | "pause"
  | "resume"
  | "rewind"
  | "end";

export type WorldMovementDirection =
  | "none"
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "forward-left"
  | "forward-right"
  | "backward-left"
  | "backward-right";

export type WorldLookDirection =
  | "none"
  | "up"
  | "down"
  | "left"
  | "right"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

export type WorldInteractionAction = "none" | "jump" | "attack" | "crouch" | "sprint";

export interface WorldTravelCommand {
  movement?: WorldMovementDirection;
  look?: WorldLookDirection;
  interaction?: WorldInteractionAction;
}

export interface WorldTravelStartResult {
  providerTravelId: string;
  firstFrameUrl: string | null;
  maxExperienceSeconds: 60 | 90 | 120 | null;
}

export interface WorldTravelRuntimeEvents {
  onStatusChange?: (status: WorldStreamStatus) => void;
  onFirstFrame?: (url: string) => void;
  onCompleted?: () => void;
  onError?: (error: unknown) => void;
}

export interface WorldTravelRuntime {
  can(action: WorldTravelAction): boolean;
  start(): Promise<WorldTravelStartResult>;
  move(command: WorldTravelCommand): Promise<void>;
  instruct(content: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  rewind(seconds: number): Promise<{ resumedAtSeconds: number }>;
  updateToken(token: string): void;
  end(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateWorldTravelRuntimeInput {
  providerKey: WorldModelProviderKey;
  connection: WorldSessionConnection;
  maxExperienceSeconds: 60 | 90 | 120 | null;
  events?: WorldTravelRuntimeEvents;
}

export type WorldTravelRuntimeFactory = (
  input: CreateWorldTravelRuntimeInput
) => Promise<WorldTravelRuntime>;
