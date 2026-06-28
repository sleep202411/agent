/**
 * Shareable "postcard" for an IP — a 9:16 image with the poster on top and an
 * info strip below (title, creator, QR code, FizzDragon wordmark). It renders
 * OFF-SCREEN behind a `ViewShot` ref so `captureRef` can rasterize it to a PNG
 * without it ever being visible; the screen then hands that file to the native
 * share sheet.
 *
 * The card is laid out at a FIXED logical size (CARD_WIDTH × CARD_HEIGHT). The
 * capture scales it up via the device pixel ratio, so the exported PNG is
 * crisp (~1080×1920 on a 3x screen) regardless of the logical size here.
 */
import { Image } from "expo-image";
import { forwardRef, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import type { IpDetail } from "@/data/types";

/** Logical card size — a 9:16 postcard. The capture upsizes via pixelRatio. */
export const CARD_WIDTH = 360;
export const CARD_HEIGHT = 640;

const QR_SIZE = 72;

type ShareCardProps = {
  ip: IpDetail;
  /** Display name of the first creator (already resolved by the screen). */
  creatorName?: string;
  /** Absolute URL the QR code encodes (the IP's locale-prefixed web page). */
  shareUrl: string;
  /** Brand wordmark string (localized). */
  brand: string;
  /**
   * Fired once the poster is ready to be captured — on `Image.onLoad` when a
   * poster URL exists, or immediately (on mount) when there's no poster and the
   * fallback initial is shown. The screen gates `captureRef` on this so the
   * snapshot never has a blank poster.
   */
  onPosterReady?: () => void;
};

/**
 * Off-screen postcard. Wrap in a parent that positions it out of view; expose
 * the `ViewShot` ref to the caller for `captureRef`.
 */
export const ShareCard = forwardRef<ViewShotRef, ShareCardProps>(function ShareCard(
  { ip, creatorName, shareUrl, brand, onPosterReady },
  ref
) {
  const poster = ip.coverUrl ?? ip.backdropUrl;

  // No poster URL → the fallback initial is shown, so there's nothing to load:
  // signal "ready" once on mount so the screen never waits forever.
  useEffect(() => {
    if (!poster) onPosterReady?.();
  }, [poster, onPosterReady]);

  return (
    <ViewShot ref={ref} options={{ format: "png", quality: 1 }} style={styles.shot}>
      <View style={styles.card}>
        {/* Poster — top ~70%, cover-fit, rounded top corners. */}
        <View style={styles.posterWrap}>
          {poster ? (
            <Image
              source={{ uri: poster }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onLoad={() => onPosterReady?.()}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
              <ThemedText type="title" style={styles.posterInitial}>
                {ip.title.trim().slice(0, 1).toUpperCase()}
              </ThemedText>
            </View>
          )}
        </View>

        {/* Info strip — bottom ~30%. */}
        <View style={styles.strip}>
          <View style={styles.stripText}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
              {ip.title}
            </ThemedText>
            {creatorName ? (
              <ThemedText type="smallBold" style={styles.creator} numberOfLines={1}>
                {`@${creatorName}`}
              </ThemedText>
            ) : null}
            <ThemedText type="code" style={styles.brand}>
              {brand}
            </ThemedText>
          </View>

          <View style={styles.qrWrap}>
            <QRCode value={shareUrl} size={QR_SIZE} color="#0C0E14" backgroundColor="#FFFFFF" />
          </View>
        </View>
      </View>
    </ViewShot>
  );
});

const STRIP_HEIGHT = Math.round(CARD_HEIGHT * 0.3);

const styles = StyleSheet.create({
  shot: {
    // The ViewShot wrapper itself is sized to the card so the capture has no
    // transparent padding around it.
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: Colors.dark.background,
  },
  posterWrap: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundSelected,
  },
  posterFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.backgroundSelected,
  },
  posterInitial: {
    fontSize: 96,
    lineHeight: 104,
    opacity: 0.5,
    color: Colors.dark.text,
  },
  strip: {
    height: STRIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: Colors.dark.backgroundElement,
  },
  stripText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 22,
    lineHeight: 26,
    color: Colors.dark.text,
  },
  creator: {
    color: Colors.dark.brand,
  },
  brand: {
    color: Colors.dark.textSecondary,
    letterSpacing: 1,
    marginTop: 4,
  },
  qrWrap: {
    width: QR_SIZE + 16,
    height: QR_SIZE + 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
});
