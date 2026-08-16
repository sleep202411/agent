import type { IconProps } from "@tabler/icons-react";

/**
 * Audio-media glyph used where the UI represents an audio asset, node, or
 * generation modality. Playback volume and mute controls intentionally keep
 * Tabler's speaker glyphs because those describe a different action.
 */
export function IconAudioWaveform({ size = 24, stroke = 2, title, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d="M3 10v4" />
      <path d="M6 7v10" />
      <path d="M9 5v14" />
      <path d="M12 2v20" />
      <path d="M15 8v8" />
      <path d="M18 6v12" />
      <path d="M21 10v4" />
    </svg>
  );
}
