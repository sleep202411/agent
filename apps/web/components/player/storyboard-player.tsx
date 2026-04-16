import { useMemo } from "react";
import { Player } from "@remotion/player";
import { StoryboardComposition } from "./storyboard-composition";
import type { CompositionProps } from "./storyboard-composition";
import type { Shot } from "@/src/store/slices/agentSlice";

const FPS = 30;

/** Accept any shot-like object with at least these fields */
type PlayerShot = Pick<
  Shot,
  "id" | "shotNumber" | "description" | "dialogue" | "narration" | "duration"
> &
  Partial<Pick<Shot, "imageUrl" | "videoUrl" | "dialogueAudioUrl" | "narrationAudioUrl">>;

interface StoryboardPlayerProps {
  shots: PlayerShot[];
  bgmUrl?: string;
  /** "16:9" or "9:16" */
  aspectRatio?: string;
  className?: string;
}

export function StoryboardPlayer({
  shots,
  bgmUrl,
  aspectRatio = "9:16",
  className,
}: StoryboardPlayerProps) {
  const totalDurationInFrames = useMemo(
    () =>
      Math.max(
        shots.reduce((sum, shot) => sum + Math.round(shot.duration * FPS), 0),
        1
      ),
    [shots]
  );

  const width = 1280;
  const height = 960;

  const inputProps: CompositionProps = useMemo(
    () => ({ shots: shots as Shot[], bgmUrl }),
    [shots, bgmUrl]
  );

  return (
    <div className={className} style={{ width: "100%", aspectRatio: "4/3" }}>
      <Player
        component={StoryboardComposition}
        inputProps={inputProps}
        durationInFrames={totalDurationInFrames}
        fps={FPS}
        compositionWidth={width}
        compositionHeight={height}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8,
          overflow: "hidden",
        }}
        controls
        autoPlay={false}
        loop
      />
    </div>
  );
}
