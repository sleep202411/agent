import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { Spacing } from "@/constants/theme";

/** Web cinematic primary CTA (`--experience-color-accent` fallback). */
export const EXPERIENCE_START_ACCENT = "#ef233c";
const FALLBACK_SURFACE = "#2a241c";

export interface ExperienceStartShellProps {
  eyebrow: string;
  title: string;
  summary?: string | null;
  coverUri?: string | null;
  /** Warm paper tone under a missing / failed cover. */
  surface?: string;
  /** Always the player verb (e.g. Start experience) — never a system status string. */
  ctaLabel: string;
  ctaDisabled?: boolean;
  /** Small in-button spinner while manifest/bootstrap is still running. */
  ctaBusy?: boolean;
  /** e.g. "Loading footage 42%" — shown while video clips preload before start. */
  loadingMediaLabel?: string | null;
  /** 0–100 while catalogue preload is in progress; omit when idle / done. */
  loadingMediaPercent?: number | null;
  onPressCta?: () => void;
  /** Parent can advance to the next cover candidate. */
  onCoverError?: () => void;
}

/**
 * Cinematic start / boot stage — shared by the play-route bootstrap (preview
 * from the list card) and ExperiencePlayer once the manifest is ready.
 */
export function ExperienceStartShell({
  eyebrow,
  title,
  summary,
  coverUri,
  surface = FALLBACK_SURFACE,
  ctaLabel,
  ctaDisabled,
  ctaBusy,
  loadingMediaLabel,
  loadingMediaPercent,
  onPressCta,
  onCoverError,
}: ExperienceStartShellProps) {
  const showMediaProgress =
    loadingMediaLabel != null || (loadingMediaPercent != null && loadingMediaPercent >= 0);
  const barWidth =
    loadingMediaPercent != null ? Math.max(0, Math.min(100, loadingMediaPercent)) : null;

  return (
    <View style={styles.startScreen}>
      <View style={[styles.coverFill, { backgroundColor: surface }]} />
      {coverUri ? (
        <Image
          key={coverUri}
          source={{ uri: coverUri }}
          style={styles.coverFill}
          contentFit="cover"
          transition={220}
          onError={() => {
            console.warn("[experience-player] cover image failed", coverUri);
            onCoverError?.();
          }}
        />
      ) : null}
      <View style={styles.startScrim} />
      <View style={styles.startCopy}>
        <Text style={styles.startEyebrow}>{eyebrow}</Text>
        <Text style={styles.startTitle} numberOfLines={3}>
          {title}
        </Text>
        {summary ? (
          <Text style={styles.startSummary} numberOfLines={5}>
            {summary}
          </Text>
        ) : null}
        {showMediaProgress ? (
          <View
            style={styles.loadingBlock}
            accessibilityRole="progressbar"
            accessibilityValue={
              barWidth != null ? { min: 0, max: 100, now: Math.floor(barWidth) } : undefined
            }
            accessibilityLabel={loadingMediaLabel ?? undefined}
          >
            {barWidth != null ? (
              <View style={styles.loadingTrack}>
                <View style={[styles.loadingFill, { width: `${barWidth}%` }]} />
              </View>
            ) : null}
            {loadingMediaLabel ? (
              <Text style={styles.loadingMedia}>{loadingMediaLabel}</Text>
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={ctaDisabled || !onPressCta}
          onPress={onPressCta}
          style={({ pressed }) => [
            styles.startButtonHit,
            (ctaDisabled || pressed) && styles.startButtonPressed,
          ]}
        >
          <View
            style={[
              styles.startButton,
              { backgroundColor: EXPERIENCE_START_ACCENT },
              ctaDisabled && styles.startButtonDisabled,
            ]}
          >
            {ctaBusy ? <ActivityIndicator color="#FFFFFF" style={styles.ctaSpinner} /> : null}
            <Text style={styles.startButtonLabel}>{ctaLabel}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  startScreen: { flex: 1 },
  coverFill: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  startScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  startCopy: {
    flex: 1,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.six,
    gap: Spacing.three,
    justifyContent: "center",
    alignItems: "center",
  },
  startEyebrow: {
    color: "rgba(255,255,255,0.48)",
    letterSpacing: 2,
    textTransform: "uppercase",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
  },
  startTitle: {
    color: "#FFFFFF",
    textAlign: "center",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "600",
  },
  startSummary: {
    color: "rgba(255,255,255,0.58)",
    textAlign: "center",
    lineHeight: 22,
    fontSize: 14,
    maxWidth: 420,
  },
  loadingBlock: {
    width: "100%",
    maxWidth: 280,
    gap: 8,
    alignItems: "center",
  },
  loadingTrack: {
    width: "100%",
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  loadingFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  loadingMedia: {
    color: "rgba(255,255,255,0.52)",
    textAlign: "center",
    fontSize: 13,
    fontWeight: "600",
  },
  startButtonHit: {
    marginTop: Spacing.three,
    alignSelf: "center",
  },
  startButtonPressed: {
    opacity: 0.88,
  },
  startButton: {
    minHeight: 48,
    minWidth: 180,
    paddingHorizontal: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  startButtonDisabled: {
    opacity: 0.55,
  },
  ctaSpinner: {
    transform: [{ scale: 0.72 }],
  },
  startButtonLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
