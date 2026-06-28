/**
 * Shareable "postcard" for an IP — the IP poster on top (full 16:9, shown in
 * its natural landscape ratio) with an info strip below carrying the title,
 * @creator, a QR code and the FizzDragon wordmark. Wrapped in a `ViewShot` ref
 * so `captureRef` can rasterize it to a PNG for the share / download actions.
 *
 * The card is NOT a fixed portrait ratio: its total height is poster height
 * (width × 9/16) + the strip height, so a 16:9 cover displays fully with no
 * crop. The capture upsizes the card via the device pixel ratio, so the
 * exported PNG is crisp (e.g. ~1080-wide on a 3x screen) at the card's ratio.
 */
import { Image } from "expo-image";
import { forwardRef, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";

import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import type { IpDetail } from "@/data/types";

/** Card width (logical). The capture upsizes via pixelRatio. */
export const CARD_WIDTH = 360;
/** Poster region — full width at the cover's natural 16:9 (landscape). */
export const POSTER_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);
/** Info strip height (fixed) — fits two title lines + creator + wordmark. */
export const STRIP_HEIGHT = 132;
/** Total card height = poster + strip (NOT a forced portrait ratio). */
export const CARD_HEIGHT = POSTER_HEIGHT + STRIP_HEIGHT;

const QR_SIZE = 84;

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
   * fallback initial is shown. The caller gates `captureRef` on this so the
   * snapshot never has a blank poster.
   */
  onPosterReady?: () => void;
};

/**
 * Postcard view. Expose the `ViewShot` ref to the caller for `captureRef`.
 */
export const ShareCard = forwardRef<ViewShotRef, ShareCardProps>(function ShareCard(
  { ip, creatorName, shareUrl, brand, onPosterReady },
  ref
) {
  const poster = ip.coverUrl ?? ip.backdropUrl;

  // No poster URL → the fallback initial is shown, so there's nothing to load:
  // signal "ready" once on mount so the caller never waits forever.
  useEffect(() => {
    if (!poster) onPosterReady?.();
  }, [poster, onPosterReady]);

  return (
    <ViewShot ref={ref} options={{ format: "png", quality: 1 }} style={styles.shot}>
      <View style={styles.card}>
        {/* Poster — full width at 16:9; a 16:9 cover fills it with no crop. */}
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

        {/* Info strip — below the poster. */}
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

const styles = StyleSheet.create({
  shot: {
    // The ViewShot wrapper is sized to the card so the capture has no
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
    width: CARD_WIDTH,
    height: POSTER_HEIGHT,
    backgroundColor: Colors.dark.backgroundSelected,
  },
  posterFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.backgroundSelected,
  },
  posterInitial: {
    fontSize: 72,
    lineHeight: 80,
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
