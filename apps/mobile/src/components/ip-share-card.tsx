/**
 * Shareable "postcard" for an IP — the IP poster on top (full 16:9, shown in
 * its natural landscape ratio) with an info strip below: title, a clamped
 * synopsis and @creator on the left; the QR code with the FizzDragon wordmark
 * and the "Let's Fizz" tagline stacked beneath it on the right. Wrapped in a `ViewShot` ref so
 * `captureRef` can rasterize it to a PNG for the share / download actions.
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
/** Info strip height (fixed) — sized by the right column's QR + tagline +
 *  wordmark stack; the left column (two title lines + creator) sits lower. */
export const STRIP_HEIGHT = 184;
/** Total card height = poster + strip (NOT a forced portrait ratio). */
export const CARD_HEIGHT = POSTER_HEIGHT + STRIP_HEIGHT;

const QR_SIZE = 84;

// The FizzDragon wordmark (red on transparent) — sits beneath the QR code so
// the scan target and the brand read as one unit.
const FIZZ_LOGO = require("@/assets/images/fizzdragon-logo.png");
const BRAND_TAGLINE = "Let's Fizz";

type ShareCardProps = {
  ip: IpDetail;
  /** Display name of the first creator (already resolved by the screen). */
  creatorName?: string;
  /** Avatar URL of the first creator (real or dicebear fallback, resolved by the screen). */
  creatorAvatar?: string;
  /** Absolute URL the QR code encodes (the IP's locale-prefixed web page). */
  shareUrl: string;
  /**
   * Fired once the poster is ready to be captured — on `Image.onLoad` when a
   * poster URL exists, or immediately (on mount) when there's no poster and the
   * fallback initial is shown. The caller gates `captureRef` on this so the
   * snapshot never has a blank poster.
   */
  onPosterReady?: () => void;
  onPosterError?: () => void;
};

/**
 * Postcard view. Expose the `ViewShot` ref to the caller for `captureRef`.
 */
export const ShareCard = forwardRef<ViewShotRef, ShareCardProps>(function ShareCard(
  { ip, creatorName, creatorAvatar, shareUrl, onPosterReady, onPosterError },
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
              onError={() => onPosterError?.()}
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
            {ip.synopsis.trim() ? (
              // Clamped, not auto-sizing: the card is rasterized at a fixed
              // geometry, so long synopses ellipsize instead of reflowing
              // the export.
              <ThemedText style={styles.synopsis} numberOfLines={3}>
                {ip.synopsis.trim()}
              </ThemedText>
            ) : null}
            {creatorName ? (
              <View style={styles.creatorRow}>
                {creatorAvatar ? (
                  <Image
                    source={{ uri: creatorAvatar }}
                    style={styles.creatorAvatar}
                    contentFit="cover"
                  />
                ) : null}
                <ThemedText type="smallBold" style={styles.creator} numberOfLines={1}>
                  {`@${creatorName}`}
                </ThemedText>
              </View>
            ) : null}
          </View>

          <View style={styles.qrColumn}>
            <View style={styles.qrWrap}>
              <QRCode value={shareUrl} size={QR_SIZE} color="#0C0E14" backgroundColor="#FFFFFF" />
            </View>
            <Image source={FIZZ_LOGO} style={styles.brandLogo} contentFit="contain" />
            <ThemedText type="code" style={styles.brandTagline}>
              {BRAND_TAGLINE}
            </ThemedText>
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
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: Colors.dark.backgroundElement,
  },
  stripText: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    color: Colors.dark.text,
  },
  synopsis: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.dark.textSecondary,
  },
  creatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  creatorAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.dark.backgroundSelected,
  },
  // Same secondary tier as the tagline — the wordmark is the card's only
  // red; the creator handle is metadata, not an accent.
  creator: {
    flexShrink: 1,
    color: Colors.dark.textSecondary,
  },
  brandLogo: {
    width: 84,
    height: 15,
    marginTop: 5,
  },
  brandTagline: {
    color: Colors.dark.textSecondary,
    letterSpacing: 1,
  },
  // QR with the wordmark + tagline stacked beneath — the scan target and the
  // brand read as one unit, and the wordmark stays the card's only red.
  qrColumn: {
    alignItems: "center",
    gap: 5,
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
