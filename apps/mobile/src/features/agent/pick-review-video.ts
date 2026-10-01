import { getDocumentAsync } from "expo-document-picker";
import {
  CONTENT_REVIEW_VIDEO_MAX_BYTES,
  contentReviewCreditsForDurationSeconds,
} from "@repo/shared";
import { reviewVideoSource } from "./review-video-source";
import { reviewVideoDuration } from "./review-video-duration";

/** Selection only: no upload or billing before the user confirms the quote. */
export async function pickReviewVideo(signal: AbortSignal) {
  signal.throwIfAborted();
  const picked = await getDocumentAsync({
    type: ["video/mp4", "video/quicktime"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  signal.throwIfAborted();
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) throw new Error("No video selected");
  const source = reviewVideoSource(asset);
  if (
    !Number.isSafeInteger(source.size) ||
    source.size <= 0 ||
    source.size > CONTENT_REVIEW_VIDEO_MAX_BYTES
  )
    throw new Error("Select a nonempty video no larger than 2 GB");
  // Browser pickers can return data URIs. Use an object URL instead of decoding a
  // whole video into base64, and revoke it as soon as metadata has been read.
  const objectUrl = asset.file ? URL.createObjectURL(asset.file) : undefined;
  try {
    const durationSeconds = await reviewVideoDuration(objectUrl ?? asset.uri, signal);
    signal.throwIfAborted();
    return {
      source,
      durationSeconds,
      credits: contentReviewCreditsForDurationSeconds(durationSeconds),
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
