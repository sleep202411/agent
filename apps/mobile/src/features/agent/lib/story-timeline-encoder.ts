import { createNativeTimelineEncoder } from "./story-timeline-export-native";
import { shareTimelineVideo } from "./story-timeline-share.native";
export function createTimelineEncoder() {
  return { ...createNativeTimelineEncoder(), share: shareTimelineVideo };
}
