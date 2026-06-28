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
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef, type ViewShotRef } from "react-native-view-shot";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { IpDetail } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

import { CARD_HEIGHT, CARD_WIDTH, ShareCard } from "./ip-share-card";

type SymbolName = SymbolViewProps["name"];

type ShareSheetProps = {
  visible: boolean;
  ip: IpDetail;
  /** Display name of the first creator (already resolved by the screen). */
  creatorName?: string;
  /** Avatar URL of the first creator (real or dicebear fallback). */
  creatorAvatar?: string;
  /** Absolute URL the QR code encodes (the IP's locale-prefixed web page). */
  shareUrl: string;
  /** Brand wordmark string (localized). */
  brand: string;
  onClose: () => void;
};

export function ShareSheet({
  visible,
  ip,
  creatorName,
  creatorAvatar,
  shareUrl,
  brand,
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
  const [savingState, setSavingState] = useState(false);
  const busy = sharingState || savingState;

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

  const onDownload = async () => {
    if (busy) return;
    setSavingState(true);
    try {
      // Lazy-load the native module so a dev client not yet rebuilt with it
      // still renders the modal + Share; only Download needs the native side.
      const MediaLibrary = await import("expo-media-library");
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("ipDetail.savePermissionDenied"));
        return;
      }
      const uri = await capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(t("ipDetail.saveSuccess"));
    } catch (error) {
      console.warn("[ip share] save failed", error);
      Alert.alert(t("ipDetail.saveFailed"));
    } finally {
      setSavingState(false);
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
                brand={brand}
                onPosterReady={markPosterReady}
              />
            </View>
          </View>

          {/* Solid panel so the buttons read as obvious controls, not icons
              floating on the dark backdrop. */}
          <View
            style={[
              styles.panel,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                paddingBottom: Spacing.four + insets.bottom,
              },
            ]}
          >
            <View style={styles.actions}>
              <ActionButton
                label={t("ipDetail.share")}
                symbol={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
                busy={sharingState}
                disabled={busy}
                tone="primary"
                onPress={() => void onShare()}
              />
              <ActionButton
                label={t("ipDetail.download")}
                symbol={{
                  ios: "arrow.down.to.line",
                  android: "file_download",
                  web: "file_download",
                }}
                busy={savingState}
                disabled={busy}
                tone="secondary"
                onPress={() => void onDownload()}
              />
            </View>

            <Pressable
              accessibilityLabel={t("report.close")}
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { borderColor: theme.border },
                pressed && styles.pressed,
                busy && styles.actionDisabled,
              ]}
            >
              <ThemedText type="smallBold">{t("report.close")}</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </View>
  );
}

function ActionButton({
  label,
  symbol,
  busy,
  disabled,
  tone,
  onPress,
}: {
  label: string;
  symbol: SymbolName;
  busy: boolean;
  disabled: boolean;
  tone: "primary" | "secondary";
  onPress: () => void;
}) {
  const theme = useTheme();
  const primary = tone === "primary";
  // Primary = solid brand fill (white text). Secondary = lighter surface with a
  // visible border so it reads as a distinct, tappable button (not near-black).
  const bg = primary ? theme.brand : theme.backgroundSelected;
  const fg = primary ? "#FFFFFF" : theme.text;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: bg, borderColor: primary ? bg : theme.border },
        pressed && styles.pressed,
        disabled && !busy && styles.actionDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          <SymbolView name={symbol} size={18} tintColor={fg} />
          <ThemedText type="smallBold" style={{ color: fg }}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  closeButton: {
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.78,
  },
});
