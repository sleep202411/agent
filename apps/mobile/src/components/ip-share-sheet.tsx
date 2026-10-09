/**
 * Share sheet for an IP — a modal that PREVIEWS the generated postcard (poster
 * at its natural 16:9 + info strip; visible, scaled to fit) and offers two
 * actions: Share (native share sheet) and Download (save the PNG to the photo
 * library).
 *
 * Capture resolution: the `ShareCard` is rendered at its FULL logical size
 * (CARD_WIDTH × CARD_HEIGHT) inside the `ViewShot`, and only the *preview
 * container* is shrunk via a `transform: scale`. A transform doesn't change the
 * child's layout box, so `captureRef` still snapshots the card at full layout
 * size → upscaled by the device pixel ratio → a crisp full-res PNG.
 */
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
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
  const posterWaitersRef = useRef<Set<() => void>>(new Set());
  // Per-action busy flags drive the button spinners; `busy` blocks both
  // buttons + scrim/close while either action is running.
  const [sharingState, setSharingState] = useState(false);
  const busy = sharingState;

  const markPosterReady = () => {
    posterReadyRef.current = true;
    for (const resolve of posterWaitersRef.current) resolve();
    posterWaitersRef.current.clear();
  };

  // Resolve once the poster is ready, or after a 2.5s fallback so a slow/broken
  // image URL can't hang the action — we capture anyway after the timeout.
  const waitForPoster = () =>
    new Promise<void>((resolve) => {
      if (posterReadyRef.current) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        posterWaitersRef.current.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 2500);
      posterWaitersRef.current.add(done);
    });

  // Full-resolution snapshot of the postcard (always the card's true layout
  // size, regardless of the preview scale).
  const capture = async () => {
    await waitForPoster();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
  };

  const onShare = async () => {
    if (busy) return;
    setSharingState(true);
    try {
      const uri = await capture();
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t("ipDetail.shareUnavailable"));
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: ip.title,
        UTI: "public.png",
      });
    } catch (error) {
      console.warn("[ip share] share failed", error);
      Alert.alert(t("ipDetail.shareFailed"));
    } finally {
      setSharingState(false);
    }
  };

  // Fit the 9:16 card into the available preview area while keeping aspect
  // ratio; never upscale past 1.
  const maxPreviewW = width - Spacing.five * 2;
  const maxPreviewH = height * 0.64;
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
          onAccessibilityEscape={onClose}
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
                ref={cardRef}
                ip={ip}
                creatorName={creatorName}
                creatorAvatar={creatorAvatar}
                shareUrl={shareUrl}
                onPosterReady={markPosterReady}
              />
            </View>
          </View>

          {/* Transparent wrapper — just sizes + positions the Share button. */}
          <View style={[styles.panel, { paddingBottom: insets.bottom }]}>
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
              {busy ? (
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
