import {
  VideoProviderLoader,
  type MediaContext,
  type PlayerSrc,
  type Src,
  type VideoMimeType,
  type VideoProvider,
} from "@vidstack/react";

const VIDEO_MIME_TYPES = new Set<VideoMimeType | "video/quicktime">([
  "video/mp4",
  "video/webm",
  "video/3gp",
  "video/ogg",
  "video/avi",
  "video/mpeg",
  "video/object",
  "video/quicktime",
]);

/**
 * Vidstack recognizes .mov URLs, but its MIME allowlist omits video/quicktime.
 * Published clips use extensionless /content redirects, so dropping that MIME
 * makes the same footage fail provider selection even though Preview plays it.
 * Let the native video element load MOV and report actual decode errors, just
 * as it does for the direct .mov URL; canPlayType alone is not a decode test.
 */
export class ExperienceVideoProviderLoader extends VideoProviderLoader {
  override canPlay(source: Src): boolean {
    return (
      (typeof source.src === "string" && source.type === "video/quicktime") || super.canPlay(source)
    );
  }

  override async load(context: MediaContext): Promise<VideoProvider> {
    const provider = await super.load(context);
    const loadSource = provider.loadSource.bind(provider);
    provider.loadSource = async (source, preload) => {
      if (source.type !== "video/quicktime") return loadSource(source, preload);
      // A <source type="video/quicktime"> can be skipped by a browser that can
      // decode MOV but does not advertise that MIME in canPlayType. Use <video
      // src> like the working preview. The "?" stays inside the chosen native
      // provider; it cannot trigger Vidstack's HEAD-based format detection.
      await loadSource({ ...source, type: "?" }, preload);
      const current = provider.currentSrc;
      if (current && current.src === source.src) {
        provider.currentSrc = { ...current, type: source.type };
      }
    };
    return provider;
  }
}

export const EXPERIENCE_VIDEO_LOADERS = [ExperienceVideoProviderLoader];

/** Both spellings of the HLS master MIME a server may answer with. */
const HLS_MIME_TYPES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl"]);

export function normalizeVideoSource(source: { src: string; type?: string | null }): PlayerSrc {
  const normalizedType = source.type?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedType && VIDEO_MIME_TYPES.has(normalizedType as VideoMimeType | "video/quicktime")) {
    // The custom loader supports the real QuickTime MIME at runtime. Vidstack's
    // PlayerSrc union only lists its built-in loaders' MIME types.
    return { src: source.src, type: normalizedType } as PlayerSrc;
  }
  if (normalizedType && HLS_MIME_TYPES.has(normalizedType)) {
    // A negotiated master declares its MIME. Passing it on routes the source
    // to Vidstack's own HLS loader whatever the URL looks like — hls.js, or the
    // native element where `preferNativeHLS` puts that first.
    return { src: source.src, type: "application/vnd.apple.mpegurl" };
  }
  return source.src;
}
