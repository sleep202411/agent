import IconArrowUp from "@tabler/icons-react-native/icons/IconArrowUp";
import IconPlayerStopFilled from "@tabler/icons-react-native/icons/IconPlayerStopFilled";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import type { AgentOsModelProfile } from "../api/agent-os-api";
import { AgentModelMenu } from "./agent-model-menu";

const theme = Colors.dark;
/** Same #E52227 as 开始创作 / home +. */
const BRAND_RED = theme.brand;

type AgentComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Larger hub-style box vs compact thread footer. */
  variant?: "hub" | "thread";
  submitAccessibilityLabel: string;
  /** When true, replaces send with a stop control (PC FizzAgent composer). */
  busy?: boolean;
  onStop?: () => void;
  stopAccessibilityLabel?: string;
  sendDisabled?: boolean;
  modelProfileId?: string;
  modelOptions?: readonly AgentOsModelProfile[];
  onModelProfileChange?: (id: string) => void;
  modelMenuLabel?: string;
  modelMenuDisabled?: boolean;
  /** Links to KeyboardGestureArea for interactive keyboard dismiss. */
  nativeID?: string;
};

export function AgentComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  variant = "hub",
  submitAccessibilityLabel,
  busy = false,
  onStop,
  stopAccessibilityLabel,
  sendDisabled = false,
  modelProfileId,
  modelOptions,
  onModelProfileChange,
  modelMenuLabel,
  modelMenuDisabled = false,
  nativeID,
}: AgentComposerProps) {
  const colors = useTheme();
  const canSend = value.trim().length > 0 && !sendDisabled && !busy;
  const showModelMenu =
    variant === "thread" &&
    modelProfileId &&
    modelOptions &&
    modelOptions.length > 0 &&
    onModelProfileChange &&
    modelMenuLabel;

  if (variant === "thread") {
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
          <TextInput
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
            <View style={styles.toolbarSpacer} />
            {showModelMenu ? (
              <View style={styles.modelSlot}>
                <AgentModelMenu
                  value={modelProfileId}
                  options={modelOptions}
                  label={modelMenuLabel}
                  onValueChange={onModelProfileChange}
                  disabled={modelMenuDisabled || sendDisabled}
                />
              </View>
            ) : null}
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

  return (
    <View
      style={[
        styles.box,
        styles.boxHub,
        {
          backgroundColor: colors.backgroundElement,
          borderColor: canSend ? colors.brand : colors.border,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        multiline
        style={[styles.input, { color: colors.text }]}
        returnKeyType="send"
        blurOnSubmit
        onSubmitEditing={() => {
          if (canSend) onSubmit();
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitAccessibilityLabel}
        accessibilityState={{ disabled: !canSend }}
        onPress={() => {
          if (!canSend) return;
          onSubmit();
        }}
        style={({ pressed }) => [pressed && canSend && styles.pressed]}
      >
        <View
          style={[
            styles.send,
            {
              backgroundColor: canSend ? BRAND_RED : theme.backgroundSelected,
            },
          ]}
        >
          <IconArrowUp
            size={18}
            color={canSend ? "#FFFFFF" : theme.textSecondary}
            strokeWidth={2.5}
          />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  boxHub: {
    minHeight: 112,
  },
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
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    padding: 0,
    textAlignVertical: "top",
  },
  inputThread: {
    fontSize: 15,
    lineHeight: 22,
    maxHeight: 132,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: Spacing.one,
    textAlignVertical: "top",
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 36,
    paddingTop: 0,
  },
  toolbarSpacer: {
    flex: 1,
  },
  modelSlot: {
    flexShrink: 1,
    maxWidth: "62%",
    minWidth: 0,
  },
  send: {
    alignSelf: "flex-end",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
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
