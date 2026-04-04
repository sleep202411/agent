"use client";

import {
  AbsoluteFill,
  Sequence,
  Img,
  Video,
  Audio,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import type { Shot } from "@/src/store/slices/agentSlice";

// ─── Types ──────────────────────────────────────────────

export interface CompositionProps {
  shots: Shot[];
  bgmUrl?: string;
  [key: string]: unknown;
}

// ─── Main Composition ───────────────────────────────────

export const StoryboardComposition: React.FC<CompositionProps> = ({ shots, bgmUrl }) => {
  const { fps } = useVideoConfig();

  let currentFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {shots.map((shot) => {
        const durationInFrames = Math.max(Math.round(shot.duration * fps), 1);
        const from = currentFrame;
        currentFrame += durationInFrames;

        return (
          <Sequence key={shot.id} from={from} durationInFrames={durationInFrames}>
            <ShotScene shot={shot} />
          </Sequence>
        );
      })}

      {/* BGM audio track — spans full composition */}
      {bgmUrl && <Audio src={bgmUrl} volume={0.3} />}
    </AbsoluteFill>
  );
};

// ─── Single Shot Scene ──────────────────────────────────

function ShotScene({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Fade in/out
  const opacity = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Video or Image */}
      {shot.videoUrl ? (
        <Video
          src={shot.videoUrl}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : shot.imageUrl ? (
        <Img src={shot.imageUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      ) : (
        <AbsoluteFill
          style={{
            backgroundColor: "#1a1a1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 48, fontWeight: "bold" }}>
            {shot.shotNumber}
          </div>
        </AbsoluteFill>
      )}

      {/* Shot number badge */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          backgroundColor: "rgba(0,0,0,0.6)",
          color: "white",
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 10px",
          borderRadius: 6,
        }}
      >
        镜头 {shot.shotNumber}
      </div>

      {/* Dialogue audio */}
      {shot.dialogueAudioUrl && <Audio src={shot.dialogueAudioUrl} volume={1} />}

      {/* Narration audio */}
      {shot.narrationAudioUrl && <Audio src={shot.narrationAudioUrl} volume={0.8} />}

      {/* Subtitle: dialogue */}
      {shot.dialogue && (
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 20,
            right: 20,
            textAlign: "center",
          }}
        >
          <span
            style={{
              backgroundColor: "rgba(0,0,0,0.6)",
              color: "white",
              fontSize: 16,
              fontWeight: 500,
              padding: "6px 16px",
              borderRadius: 8,
            }}
          >
            {shot.dialogue}
          </span>
        </div>
      )}

      {/* Subtitle: narration */}
      {shot.narration && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            right: 20,
            textAlign: "center",
          }}
        >
          <span
            style={{
              backgroundColor: "rgba(0,0,0,0.4)",
              color: "rgba(255,255,255,0.9)",
              fontSize: 14,
              fontStyle: "italic",
              padding: "4px 12px",
              borderRadius: 6,
            }}
          >
            {shot.narration}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
}
