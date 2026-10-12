import type { WorldCommand } from "../../../../world-player/protocol";

export type WorldRuntimeFrameHandle = { send(message: WorldCommand): void };
export type WorldRuntimeFrameProps = {
  html: string;
  title: string;
  onMessage(raw: unknown): void;
  onError(error: Error): void;
};
