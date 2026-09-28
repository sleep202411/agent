import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const theme = Colors.dark;
/** Same #E52227 as 开始创作 / home +. */
const BRAND_RED = theme.brand;
const INPUT_MIN_HEIGHT = 56;
const INPUT_MAX_HEIGHT = 132;

type AgentComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitAccessibilityLabel: string;
  /** When true, replaces send with a stop control (PC FizzAgent composer). */
  busy?: boolean;
  onStop?: () => void;
  stopAccessibilityLabel?: string;
  sendDisabled?: boolean;
  /** Allow sending with empty text (an attachment carries the content). */
  canSendWithoutText?: boolean;
  /** Skills / file chips above the textarea (H5 CopilotComposer attachmentBar). */
  attachmentBar?: ReactNode;
  /** Bottom toolbar, leading side (paperclip). */
  leadingAction?: ReactNode;
  /** Bottom toolbar, immediately left of send (permission). */
  beforeSend?: ReactNode;
  /** Links to KeyboardGestureArea for interactive keyboard dismiss. */
  nativeID?: string;
};

export function AgentComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  submitAccessibilityLabel,
  busy = false,
  onStop,
  stopAccessibilityLabel,
  sendDisabled = false,
  canSendWithoutText = false,
  attachmentBar,
  leadingAction,
  beforeSend,
  nativeID,
}: AgentComposerProps) {
  const colors = useTheme();
  const canSend = (value.trim().length > 0 || canSendWithoutText) && !sendDisabled && !busy;
  const [inputEpoch, setInputEpoch] = useState(0);
  const wasEmptyRef = useRef(value.length === 0);

  useEffect(() => {
    const empty = value.length === 0;
    if (empty && !wasEmptyRef.current) setInputEpoch((epoch) => epoch + 1);
    wasEmptyRef.current = empty;
  }, [value]);

  return (
    <View style={styles.boxThreadShadow}>
      <View
        style={[
          styles.boxThread,
          {
            backgroundColor: colors.backgroundElement,
            borderColor: "rgba(255,255,255,0.12)",
          },
        ]}
      >
        {attachmentBar}

        <TextInput
          key={inputEpoch}
          nativeID={nativeID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.55)"
          multiline
          editable={!sendDisabled}
          style={[styles.inputThread, { color: colors.text }]}
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <View style={styles.toolbar}>
          {leadingAction}
          <View style={styles.toolbarSpacer} />
          {beforeSend}
          {busy && onStop ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={stopAccessibilityLabel ?? "Stop"}
              hitSlop={6}
              onPress={onStop}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <View style={[styles.sendThread, { backgroundColor: BRAND_RED }]}>
                <IconPlayerStopFilled size={16} color="#FFFFFF" />
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={submitAccessibilityLabel}
              accessibilityState={{ disabled: !canSend }}
              disabled={sendDisabled}
              hitSlop={6}
              onPress={() => {
                if (!canSend) return;
                onSubmit();
              }}
              style={({ pressed }) => [pressed && canSend && styles.pressed]}
            >
              <View
                style={[
                  styles.sendThread,
                  {
                    backgroundColor: canSend ? BRAND_RED : "rgba(229, 34, 39, 0.38)",
                  },
                ]}
              >
                <IconArrowUp
                  size={18}
                  color="#FFFFFF"
                  strokeWidth={2.5}
                  opacity={canSend ? 1 : 0.72}
                />
              </View>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Outer wrap so iOS shadow is not clipped by overflow:hidden on the card. */
  boxThreadShadow: {
    borderRadius: 26,
    elevation: 14,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  boxThread: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 0,
    overflow: "hidden",
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    paddingTop: Spacing.two,
  },
  inputThread: {
    fontSize: 15,
    lineHeight: 22,
    minHeight: INPUT_MIN_HEIGHT,
    maxHeight: INPUT_MAX_HEIGHT,
    paddingHorizontal: 0,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.one,
    textAlignVertical: "top",
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    minHeight: 36,
    paddingTop: 0,
  },
  toolbarSpacer: {
    flex: 1,
  },
  sendThread: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    overflow: "hidden",
    width: 36,
  },
  pressed: {
    opacity: 0.85,
  },
});
