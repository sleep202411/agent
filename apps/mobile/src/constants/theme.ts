import { Platform } from "react-native";

import themeTokens from "@/config/theme-tokens.json";

export const Colors = {
  light: {
    brand: themeTokens.colors.brand["500"],
    text: themeTokens.colors.light.ink,
    background: themeTokens.colors.light.canvas,
    backgroundElement: themeTokens.colors.light.surface,
    backgroundSelected: themeTokens.colors.light.surfaceMuted,
    border: themeTokens.colors.light.line,
    textSecondary: themeTokens.colors.light.inkMuted,
  },
  dark: {
    brand: themeTokens.colors.brand["400"],
    text: themeTokens.colors.dark.ink,
    background: themeTokens.colors.dark.canvas,
    backgroundElement: themeTokens.colors.dark.surface,
    backgroundSelected: themeTokens.colors.dark.surfaceMuted,
    border: themeTokens.colors.dark.line,
    textSecondary: themeTokens.colors.dark.inkMuted,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
  eight: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
