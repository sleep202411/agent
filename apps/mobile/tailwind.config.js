const tokens = require("./src/config/theme-tokens.json");

const { colors } = tokens;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: colors.brand,
        neutral: colors.neutral,
        semantic: colors.semantic,
        canvas: {
          light: colors.light.canvas,
          dark: colors.dark.canvas,
        },
        surface: {
          light: colors.light.surface,
          muted: colors.light.surfaceMuted,
          dark: colors.dark.surface,
          "dark-muted": colors.dark.surfaceMuted,
        },
        line: {
          light: colors.light.line,
          dark: colors.dark.line,
        },
        ink: {
          light: colors.light.ink,
          muted: colors.light.inkMuted,
          dark: colors.dark.ink,
          "dark-muted": colors.dark.inkMuted,
        },
      },
      borderRadius: tokens.radius,
      fontFamily: {
        sans: ["system-ui"],
        rounded: ["ui-rounded"],
        mono: ["ui-monospace"],
      },
      fontSize: tokens.fontSize,
      spacing: tokens.spacing,
    },
  },
  plugins: [],
};
