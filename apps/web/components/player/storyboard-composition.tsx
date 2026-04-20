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
import { useTranslations } from "@/src/i18n/i18n";
// ─── Types ──────────────────────────────────────────────

export interface Shot {
  id: string;
  shotNumber: number | string;
  description?: string;
  dialogue?: string;
  narration?: string;
  duration: number;
  imageUrl?: string;
  videoUrl?: string;
  dialogueAudioUrl?: string;
  narrationAudioUrl?: string;
}

export interface CompositionProps {
  shots: Shot[];
  bgmUrl?: string;
  [key: string]: unknown;
}

// ─── Main Composition ───────────────────────────────────

export const StoryboardComposition: React.FC<CompositionProps> = ({ shots, bgmUrl }) => {
  const { fps } = useVideoConfig();

  const shotFrames = shots.reduce<{ id: string; from: number; durationInFrames: number }[]>(
    (acc, shot) => {
      const durationInFrames = Math.max(Math.round(shot.duration * fps), 1);
      const from =
        acc.length > 0 ? acc[acc.length - 1].from + acc[acc.length - 1].durationInFrames : 0;
      acc.push({ id: shot.id, from, durationInFrames });
      return acc;
    },
    []
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {shots.map((shot, i) => {
        const frame = shotFrames[i];
        return (
          <Sequence key={shot.id} from={frame.from} durationInFrames={frame.durationInFrames}>
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
  const t = useTranslations("storyboard");
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
        {t("shot")} {shot.shotNumber}
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
