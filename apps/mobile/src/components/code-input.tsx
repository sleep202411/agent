import { useCallback } from "react";
import { StyleSheet, Text, type TextStyle, View } from "react-native";
import {
  CodeField,
  Cursor,
  useBlurOnFulfill,
  useClearByFocusCell,
} from "react-native-confirmation-code-field";

import { Colors, Spacing } from "@/constants/theme";

const theme = Colors.dark;

type CodeInputProps = {
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
  length: number;
  onChange: (value: string) => void;
  value: string;
};

/**
 * OTP cells via `react-native-confirmation-code-field` — the de-facto RN
 * pattern: one TextInput + N display cells, SMS autofill, tap-to-focus,
 * backspace to clear. Auto-submit stays the screen's job.
 */
export function CodeInput({
  autoFocus,
  disabled,
  invalid,
  label,
  length,
  onChange,
  value,
}: CodeInputProps) {
  const ref = useBlurOnFulfill({ value, cellCount: length });
  const [clearProps, getCellOnLayoutHandler] = useClearByFocusCell({
    value,
    setValue: onChange,
  });

  const handleChange = useCallback(
    (next: string) => {
      onChange(next.replace(/\D/g, "").slice(0, length));
    },
    [length, onChange]
  );

  return (
    <CodeField
      ref={ref}
      {...clearProps}
      accessibilityLabel={label}
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      cellCount={length}
      editable={!disabled}
      keyboardType="number-pad"
      onChangeText={handleChange}
      renderCell={({ index, symbol, isFocused }) => (
        <View
          key={index}
          onLayout={getCellOnLayoutHandler(index)}
          style={[
            styles.cell,
            isFocused && !disabled && styles.cellFocused,
            invalid && styles.cellInvalid,
          ]}
        >
          <Text style={styles.digit}>{symbol || (isFocused && !disabled ? <Cursor /> : null)}</Text>
        </View>
      )}
      rootStyle={styles.root}
      textContentType="oneTimeCode"
      value={value}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
    justifyContent: "space-between",
  },
  cell: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    height: 52,
    justifyContent: "center",
    maxWidth: 52,
  },
  cellFocused: {
    backgroundColor: "rgba(229,34,39,0.06)",
    borderColor: theme.brand,
  },
  cellInvalid: {
    borderColor: theme.brand,
  },
  digit: {
    color: theme.text,
    fontSize: 22,
    fontWeight: "600",
    textAlign: "center",
  } satisfies TextStyle,
});
