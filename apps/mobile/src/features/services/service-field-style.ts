import type { TextStyle } from "react-native";
import type { useTheme } from "@/hooks/use-theme";

/** Match the service inquiry/order fields without changing the native form layout. */
export function serviceFieldStyle(
  theme: ReturnType<typeof useTheme>,
  multiline = false
): TextStyle {
  return {
    minHeight: multiline ? 80 : 44,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    borderColor: theme.border,
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    fontSize: 14,
    lineHeight: 20,
    ...(multiline ? { textAlignVertical: "top" as const } : {}),
  };
}
