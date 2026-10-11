/* eslint-disable import/no-named-as-default-member -- hls.js types expose these statics on its default class. */
import HlsPlayer from "hls.js";
export function supportsAdaptivePlayback(): boolean {
  return (
    typeof document !== "undefined" &&
    (!!document.createElement("video").canPlayType("application/vnd.apple.mpegurl") ||
      HlsPlayer.isSupported())
  );
}
