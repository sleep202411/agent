/**
 * Share control for the play stage — the native counterpart of the web
 * `PlayShareButton`: hand the site play URL to the system share sheet at any
 * point in the film, not just at an ending.
 *
 * Mounted as the stack's `headerRight`, not as an absolutely-positioned overlay:
 * the transparent native header still hit-tests its own bounds, so a floating
 * control at `insets.top + 8` is unreachable in landscape (where `insets.top`
 * is 0). Letting the navigation bar lay it out also drops the inset math.
 *
 * Bare glyph, matching `MoreActionsButton`: the header subview is laid out under
 * a narrow width constraint that collapses a padded pill, and a bare glyph is
 * the platform idiom opposite the back chevron anyway. The label rides along as
 * the accessibility name.
 */
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Alert, Platform, Pressable, Share, StyleSheet } from "react-native";

export function ExperienceShareButton({
  label,
  failedLabel,
  shareUrl,
}: {
  label: string;
  failedLabel: string;
  shareUrl: string;
}) {
  const [sharing, setSharing] = useState(false);

  const onPress = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      // One field per platform, deliberately: iOS treats `url` as the shared
      // item (so targets can preview it) and would append a `message` as
      // separate text, pasting the link twice. Android only reads `message`.
      await Share.share(Platform.OS === "ios" ? { url: shareUrl } : { message: shareUrl }, {
        dialogTitle: label,
      });
    } catch (error) {
      // Dismissing the sheet resolves rather than throws, so anything landing
      // here is a real failure worth surfacing.
      console.warn("[experience-share] share failed", error);
      Alert.alert(failedLabel);
    } finally {
      setSharing(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: sharing }}
      disabled={sharing}
      onPress={() => void onPress()}
      hitSlop={10}
      style={({ pressed }) => (pressed || sharing ? styles.pressed : null)}
    >
      <SymbolView
        name={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
        size={22}
        tintColor="#FFFFFF"
        style={styles.glyph}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Explicit box: the symbol has no intrinsic size for Yoga to measure inside
  // the header subview.
  glyph: {
    width: 22,
    height: 22,
  },
  pressed: {
    opacity: 0.6,
  },
});
