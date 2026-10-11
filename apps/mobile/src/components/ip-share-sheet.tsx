import { setStringAsync } from "expo-clipboard";
/**
 * Share sheet for an IP — a modal that PREVIEWS the generated postcard (poster
 * at its natural 16:9 + info strip; visible, scaled to fit) and offers two
 * action: Share through the native share sheet.
 *
 * Capture resolution: the `ShareCard` is rendered at its FULL logical size
 * (CARD_WIDTH × CARD_HEIGHT) inside the `ViewShot`, and only the *preview
 * container* is shrunk via a `transform: scale`. A transform doesn't change the
 * child's layout box, so `captureRef` still snapshots the card at full layout
 * size → upscaled by the device pixel ratio → a crisp full-res PNG.
 */
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef, type ViewShotRef } from "react-native-view-shot";

import { Spacing } from "@/constants/theme";
import type { IpDetail } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

import { CARD_HEIGHT, CARD_WIDTH, ShareCard } from "./ip-share-card";

type ShareSheetProps = {
  visible: boolean;
  ip: IpDetail;
  /** Display name of the first creator (already resolved by the screen). */
  creatorName?: string;
  /** Avatar URL of the first creator (real or dicebear fallback). */
  creatorAvatar?: string;
  /** Absolute URL the QR code encodes (the IP's locale-prefixed web page). */
  shareUrl: string;
  onClose: () => void;
};

export function ShareSheet(props: ShareSheetProps) {
  if (!props.visible) return null;
  // Each visible card owns its load gate; a previous poster cannot ready a new capture.
  const cardKey = JSON.stringify([
    props.ip.id,
    props.ip.coverUrl ?? props.ip.backdropUrl,
    props.shareUrl,
  ]);
  return <VisibleShareSheet key={cardKey} {...props} />;
}

function VisibleShareSheet({
  visible,
  ip,
  creatorName,
  creatorAvatar,
  shareUrl,
  onClose,
}: ShareSheetProps) {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const cardRef = useRef<ViewShotRef>(null);
  // Poster-load gate: the capture waits on this so the snapshot never has a
  // blank poster, even though the user now watches it load.
  const posterReadyRef = useRef(false);
  const posterWaitersRef = useRef(new Set<(error?: Error) => void>());
  const alive = useRef(false);
  const pending = useRef(false);
  const posterError = useRef<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    const waiters = posterWaitersRef.current;
    return () => {
      alive.current = false;
      for (const settle of waiters) settle(new Error("Share sheet closed"));
      waiters.clear();
    };
  }, []);
  // Per-action busy flags drive the button spinners; `busy` blocks both
  // buttons + scrim/close while either action is running.
  const [sharingState, setSharingState] = useState<"share" | "copy" | null>(null);
  const busy = sharingState !== null;

  const markPosterReady = () => {
    if (!alive.current || attempt !== loadGeneration.current) return;
    posterReadyRef.current = true;
    for (const resolve of posterWaitersRef.current) resolve();
    posterWaitersRef.current.clear();
  };

  const markPosterFailed = () => {
    if (!alive.current || attempt !== loadGeneration.current) return;
    const failure = new Error(t("ipDetail.sharePosterFailed"));
    posterError.current = failure;
    for (const settle of posterWaitersRef.current) settle(failure);
    posterWaitersRef.current.clear();
  };

  // A timeout is not evidence that an image loaded. Keep the preview available
  // and let the user retry rather than exporting an empty poster.
  const waitForPoster = () =>
    new Promise<void>((resolve, reject) => {
      if (posterReadyRef.current) return resolve();
      if (posterError.current) return reject(posterError.current);
      const done = (failure?: Error) => {
        posterWaitersRef.current.delete(done);
        clearTimeout(timer);
        if (failure) reject(failure);
        else resolve();
      };
      const timer = setTimeout(() => done(new Error(t("ipDetail.sharePosterFailed"))), 10000);
      posterWaitersRef.current.add(done);
    });

  const onShare = async () => {
    if (pending.current || !alive.current) return;
    pending.current = true;
    setSharingState("share");
    if (error) {
      posterReadyRef.current = false;
      posterError.current = null;
      loadGeneration.current += 1;
      setAttempt(loadGeneration.current);
    }
    setError(null);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!alive.current) return;
      if (!available) {
        Alert.alert(t("ipDetail.shareUnavailable"));
        return;
      }
      await waitForPoster();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      if (!alive.current) return;
      const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      if (!alive.current) return;
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: ip.title,
        UTI: "public.png",
      });
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : t("ipDetail.shareFailed"));
    } finally {
      pending.current = false;
      if (alive.current) setSharingState(null);
    }
  };

  const onCopyLink = async () => {
    if (pending.current || !alive.current) return;
    pending.current = true;
    setSharingState("copy");
    try {
      if (!(await setStringAsync(shareUrl))) throw new Error(t("ipDetail.copyLinkFailed"));
      if (alive.current) Alert.alert(t("ipDetail.linkCopied"));
    } catch (failure) {
      if (alive.current)
        Alert.alert(
          t("ipDetail.copyLinkFailed"),
          failure instanceof Error ? failure.message : undefined
        );
    } finally {
      pending.current = false;
      if (alive.current) setSharingState(null);
    }
  };

  // Fit the 9:16 card into the available preview area while keeping aspect
  // ratio; never upscale past 1.
  const maxPreviewW = width - Spacing.five * 2;
  const maxPreviewH = Math.max(
    0,
    Math.min(height * 0.64, height - insets.bottom - Spacing.five * 3 - 104 - (error ? 80 : 0))
  );
  const scale = Math.min(maxPreviewW / CARD_WIDTH, maxPreviewH / CARD_HEIGHT, 1);
  const previewW = CARD_WIDTH * scale;
  const previewH = CARD_HEIGHT * scale;

  // Rendered as an in-tree absolute-fill overlay (NOT an RN Modal): on iOS a JS
  // Modal renders in a separate window that does NOT cover the native tab bar,
  // so the bar would bleed through. The IP detail stack screen sits above the
  // tab bar, so an in-tree overlay cleanly covers it.
  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("report.close")}
        style={styles.backdrop}
        onPress={busy ? undefined : onClose}
      >
        <Pressable
          accessible={false}
          onAccessibilityEscape={busy ? undefined : onClose}
          style={styles.content}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Preview footprint is the SCALED size; the card inside is full size
              and centered via transform so the capture stays full-res. */}
          <View style={[styles.previewBox, { width: previewW, height: previewH }]}>
            <View
              style={[
                styles.cardScaler,
                {
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                  transform: [
                    { translateX: -CARD_WIDTH / 2 },
                    { translateY: -CARD_HEIGHT / 2 },
                    { scale },
                  ],
                },
              ]}
            >
              <ShareCard
                key={attempt}
                ref={cardRef}
                ip={ip}
                creatorName={creatorName}
                creatorAvatar={creatorAvatar}
                shareUrl={shareUrl}
                onPosterReady={markPosterReady}
                onPosterError={markPosterFailed}
              />
            </View>
          </View>

          {/* Transparent wrapper — just sizes + positions the Share button. */}
          <View style={[styles.panel, { paddingBottom: insets.bottom }]}>
            {error && (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: theme.text, fontSize: 13, marginBottom: Spacing.three }}
              >
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ipDetail.share")}
              disabled={busy}
              onPress={() => void onShare()}
              style={{
                height: 52,
                borderRadius: 14,
                backgroundColor: theme.brand,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                opacity: busy ? 0.5 : 1,
              }}
            >
              {sharingState === "share" ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <SymbolView
                    name={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
                    size={18}
                    tintColor="#FFFFFF"
                    style={{ width: 18, height: 18 }}
                  />
                  <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
                    {t("ipDetail.share")}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("ipDetail.copyLink")}
              disabled={busy}
              onPress={() => void onCopyLink()}
              style={{
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {sharingState === "copy" ? (
                <ActivityIndicator color={theme.text} />
              ) : (
                <Text style={{ color: theme.text, fontSize: 14 }}>{t("ipDetail.copyLink")}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.five,
  },
  content: {
    alignItems: "center",
    gap: Spacing.five,
    width: "100%",
  },
  previewBox: {
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cardScaler: {
    position: "absolute",
    top: "50%",
    left: "50%",
  },
  panel: {
    width: "100%",
    maxWidth: 380,
    paddingHorizontal: Spacing.four,
  },
});
