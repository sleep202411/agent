import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function AgentComposerMenuSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: Math.max(insets.bottom, Spacing.four),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />
          <ThemedText type="smallBold" style={styles.title}>
            {title}
          </ThemedText>
          <ScrollView style={styles.body} bounces={false}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "72%",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 2,
    height: 4,
    marginBottom: Spacing.three,
    width: 36,
  },
  title: {
    marginBottom: Spacing.three,
  },
  body: {
    maxHeight: 360,
  },
});
