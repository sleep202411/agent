import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

import {
  getPlayOrientationExitCoverSnapshot,
  subscribePlayOrientationExitCover,
} from "@/hooks/use-screen-orientation";

/** Full-screen black overlay hosted in root layout (survives play unmount). */
export function PlayOrientationExitCover() {
  const visible = useSyncExternalStore(
    subscribePlayOrientationExitCover,
    getPlayOrientationExitCoverSnapshot,
    () => false
  );
  if (!visible) return null;
  // Capture touches while covering — broken home layout must not be interactive.
  return <View pointerEvents="auto" style={styles.cover} />;
}

const styles = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000000",
    zIndex: 9999,
    elevation: 9999,
  },
});
