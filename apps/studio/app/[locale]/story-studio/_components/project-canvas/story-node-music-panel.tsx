"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconLoader2,
  IconMusic,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  storyApiErrorMessage,
  type StoryGraphNode,
  type StoryNodeMusic,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

/**
 * Mirrors the server's `story_music_audio` allowlist EXACTLY. A type this gate
 * admits and the server rejects is an upload that fails after the file picker
 * closed, with a server error the creator cannot act on — so `audio/mp3`, which
 * some browsers report and the server does not accept, is deliberately absent.
 */
const MUSIC_UPLOAD_KIND = "story_music_audio";
const MUSIC_ACCEPT = "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
const MUSIC_CONTENT_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/x-wav"]);
const MUSIC_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/**
 * The content type this upload will actually carry, decided here so the gate and
 * the wire can never disagree: whatever this returns is both what the allowlist
 * was checked against and what `contentType` sends.
 *
 * An extension we know beats a browser type we do not — some browsers report
 * `audio/mp3` for a plain MP3, which the server allowlist has no entry for, and
 * forwarding that verbatim is exactly how a perfectly good file died server-side
 * with an unactionable error. `null` means nothing in the allowlist fits, so the
 * file is refused before a single byte leaves the machine.
 */
function musicContentType(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = MUSIC_CONTENT_TYPE_BY_EXTENSION[extension];
  if (byExtension) return byExtension;
  const declared = file.type.trim().toLowerCase();
  return MUSIC_CONTENT_TYPES.has(declared) ? declared : null;
}

/** A distinct track used somewhere in this story, with its authoring label. */
export interface StoryMusicTrack {
  mediaAssetId: string;
  /** Stable within one draft render: A, B, C … by first appearance. */
  label: string;
  /** How many scenes are bound to it — a returning theme is normal. */
  nodeCount: number;
}

export interface StoryNodeMusicPanelProps {
  music: StoryNodeMusic | null;
  /** Distinct tracks already used by this story, in first-appearance order. */
  tracks: StoryMusicTrack[];
  canEdit: boolean;
  /** Ownership scope for a newly uploaded track; null outside a workspace. */
  workspaceId: string | null;
  onChange: (music: StoryNodeMusic | null) => void;
}

/**
 * The scene's optional music binding. A track attached here starts when play
 * enters the scene and keeps playing across later scenes until one of them
 * binds a different track — so leaving this empty is the normal case, not an
 * omission.
 */
export function StoryNodeMusicPanel({
  music,
  tracks,
  canEdit,
  workspaceId,
  onChange,
}: StoryNodeMusicPanelProps) {
  const t = useTranslations("storyStudio.canvas.inspector.music");
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;
  const attachedTrack = music
    ? (tracks.find((track) => track.mediaAssetId === music.mediaAssetId) ?? null)
    : null;
  // Derived, so a track that stops being bound here can never read as playing.
  const playing = playingAssetId !== null && playingAssetId === music?.mediaAssetId;

  // Pausing is enough: the element's own `pause` handler is what clears the
  // playing id, so every path that silences a preview — this one, unbinding,
  // unmounting — reports the same truth.
  const stopPreview = () => {
    audioRef.current?.pause();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // Silence a preview whose track is no longer bound to this scene (cleared,
  // replaced, or changed by a collaborator). Pure external-system sync: the
  // `pause` handler below settles the state, so re-binding that same track can
  // never light the control up for audio that is not running.
  useEffect(() => {
    if (playingAssetId !== null && playingAssetId !== music?.mediaAssetId) {
      audioRef.current?.pause();
    }
  }, [music?.mediaAssetId, playingAssetId]);

  const togglePreview = () => {
    if (!music) return;
    if (playing) {
      stopPreview();
      return;
    }
    const audio = new Audio(musicPreviewUrl(music.mediaAssetId));
    const settle = () => {
      // Only the CURRENT element may speak for the control. `pause` is delivered
      // asynchronously, so rebinding the scene while a preview runs tears the old
      // element down and its event lands after the new preview has already
      // started — clearing the id on that stale event would report "stopped"
      // over audio the creator can still hear.
      if (audioRef.current !== audio) return;
      audioRef.current = null;
      if (mountedRef.current) setPlayingAssetId(null);
    };
    audio.onended = settle;
    audio.onerror = settle;
    // The only signal every silencing path shares — `pause()` is how a preview
    // is stopped, unbound, or torn down, and none of the others fire anything.
    audio.onpause = settle;
    audioRef.current = audio;
    setPlayingAssetId(music.mediaAssetId);
    void audio.play().catch(settle);
  };

  const uploadTrack = async (file: File) => {
    const contentType = musicContentType(file);
    if (!contentType) {
      setError(t("errors.type"));
      return;
    }
    stopPreview();
    setError(null);
    setProgress(0);
    try {
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: MUSIC_UPLOAD_KIND,
        contentType,
        ...(workspaceId ? { workspaceId } : {}),
        onProgress: (percent) => {
          if (mountedRef.current) setProgress(Math.min(100, Math.max(0, Math.round(percent))));
        },
      });
      if (!mountedRef.current) return;
      onChange({ mediaAssetId: uploaded.mediaAssetId });
    } catch (uploadError) {
      if (!isUploadAbort(uploadError) && mountedRef.current) {
        setError(storyApiErrorMessage(uploadError, t("errors.upload")));
      }
    } finally {
      if (mountedRef.current) setProgress(null);
    }
  };

  return (
    <section className="mt-6 rounded-[20px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] text-white/55">
          <IconMusic className="size-3.5" stroke={1.7} />
        </span>
        <h3 className="text-xs font-semibold text-white/78">{t("title")}</h3>
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-white/36">{t("description")}</p>

      {music ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.045] p-2">
          <button
            type="button"
            onClick={togglePreview}
            aria-label={playing ? t("stop") : t("play")}
            title={playing ? t("stop") : t("play")}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            {playing ? (
              <IconPlayerStop className="size-3.5 fill-current" />
            ) : (
              <IconPlayerPlay className="size-3.5 fill-current" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-white/72">
              {attachedTrack?.label ?? t("trackLabel", { letter: "A" })}
            </p>
            <p className="truncate font-mono text-[9px] text-white/32">{music.mediaAssetId}</p>
          </div>
          {canEdit ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                aria-label={t("replace")}
                title={t("replace")}
                className="grid size-7 place-items-center rounded-lg bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-40"
              >
                {busy ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconUpload className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  stopPreview();
                  onChange(null);
                }}
                aria-label={t("remove")}
                title={t("remove")}
                className="grid size-7 place-items-center rounded-lg bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-destructive focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-40"
              >
                <IconTrash className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-white/[0.035] px-3 py-2.5 text-[10px] leading-4 text-white/32">
          {t("empty")}
        </p>
      )}

      {canEdit ? (
        <>
          {tracks.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-white/42">{t("reuse")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tracks.map((track) => {
                  const active = track.mediaAssetId === music?.mediaAssetId;
                  return (
                    <button
                      key={track.mediaAssetId}
                      type="button"
                      disabled={busy}
                      aria-pressed={active}
                      onClick={() => onChange(active ? null : { mediaAssetId: track.mediaAssetId })}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[10px] transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:opacity-40",
                        active
                          ? "bg-white/[0.14] text-white"
                          : "bg-white/[0.06] text-white/55 hover:bg-white/[0.12] hover:text-white"
                      )}
                    >
                      {track.label}
                      <span className="ml-1.5 text-white/32 tabular-nums">
                        {t("usedIn", { count: track.nodeCount })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            className="mt-3 w-full rounded-xl bg-white/[0.08]"
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconUpload className="size-4" />
            )}
            {busy && progress !== null
              ? t("uploading", { progress })
              : music
                ? t("replace")
                : t("upload")}
          </Button>
          {busy && progress !== null ? (
            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t("uploading", { progress })}
            >
              <div
                className="h-full rounded-full bg-white/55 transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : (
            <p className="mt-1.5 text-center text-[9px] text-white/28">{t("accepted")}</p>
          )}
        </>
      ) : null}

      {error ? (
        <p
          className="mt-3 flex items-start gap-2 rounded-xl bg-[rgba(229,34,39,0.1)] px-3 py-2 text-[10px] leading-4 text-[#ffb2b4]"
          role="alert"
        >
          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={MUSIC_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadTrack(file);
        }}
      />
    </section>
  );
}

/** Owner-authenticated redirect to the asset's current storage URL. */
function musicPreviewUrl(mediaAssetId: string): string {
  return `/aurora/media/assets/${encodeURIComponent(mediaAssetId)}/content`;
}

/**
 * The story's distinct music tracks in first-appearance order. Labels are
 * derived, never persisted — the draft carries only the media asset id.
 */
export function collectStoryMusicTracks(
  nodes: StoryGraphNode[],
  labelFor: (letter: string) => string
): StoryMusicTrack[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const mediaAssetId = node.music?.mediaAssetId;
    if (!mediaAssetId) continue;
    counts.set(mediaAssetId, (counts.get(mediaAssetId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([mediaAssetId, nodeCount], index) => ({
    mediaAssetId,
    label: labelFor(trackLetter(index)),
    nodeCount,
  }));
}

/** 0 → A … 25 → Z, 26 → AA. */
function trackLetter(index: number): string {
  let remaining = index;
  let letter = "";
  do {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return letter;
}
