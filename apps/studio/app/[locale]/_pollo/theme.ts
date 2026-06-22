/**
 * Shared theme palette for the pollo.ai-clone surfaces (preview + new homepage).
 *
 * Lets the SAME structure flip between pollo's pink accent and our FizzStudio
 * system. Per apps/studio/DESIGN.md our system is the opposite philosophy:
 * monochrome zero-chroma surfaces, WHITE as the primary action color, and brand
 * red #E52227 only as a deliberate accent (a red-washed UI is rejected). So:
 *  - `fizz` (Mono) — white primary, red ONLY on price/discount;
 *  - `red`  (Red)  — brand red as the SUBJECT accent (primary button, active
 *                    states, headline, price) on NEUTRAL surfaces — never a red
 *                    background wash.
 * These are presets of ONE `accent` dimension; the eventual abstraction defaults
 * to one and keeps the others as a swappable token. Decision pending (user likes
 * both Mono and Red as of 2026-06-19).
 */

export type ThemeId = "pollo" | "fizz" | "red";
export const THEME_IDS: ThemeId[] = ["pollo", "fizz", "red"];
/** The homepage ships the `red` preset (see app/[locale]/page.tsx); `fizz`/`pollo` stay for reference + the pollo-clone preview. */

export type Theme = {
  label: string;
  pageBg: string;
  panelBg: string;
  railBg: string;
  popoverBg: string;
  surface: string; // neutral card/section fill (sidebar, model cards, tool thumbs)
  accentText: string; // active tab/label text fill (gradient)
  activeIcon: string; // solid color for the active tab/modality icon (neutral in shipped presets — never the CTA accent)
  word: string; // headline carousel word fill
  chevron: string; // headline dropdown chevron
  tabRing: string;
  tabGlow: string;
  railFill: string;
  railRing: string;
  railGlow: string;
  genBg: string; // primary CTA fill (Generate, Start for Free, Try Now)
  genText: string;
  genShadow: string;
  genStrike: string; // strikethrough original price
  price: string; // discount badge + credit accent + promo highlights
  presetTile: string; // preset thumbnail wash
  logoFilter: string; // applied to the colorful brand PNG logos
  idleIcon: string; // idle modality icon color
};

export const THEMES: Record<ThemeId, Theme> = {
  pollo: {
    label: "Pollo",
    pageBg: "#0F0F0F",
    panelBg: "rgba(31,31,38,0.68)",
    railBg: "rgba(30,30,36,0.88)",
    popoverBg: "#161619",
    surface: "rgba(255,255,255,0.04)",
    accentText: "linear-gradient(to right, #ffffff, #FF3466)",
    activeIcon: "#FF3466",
    word: "linear-gradient(to right, #ffffff, #FF3466)",
    chevron: "#FF3466",
    tabRing:
      "radial-gradient(120% 140% at 0% 0%, rgba(255,104,164,0.92) 0%, rgba(255,104,164,0.26) 28%, rgba(255,104,164,0) 40%), radial-gradient(120% 140% at 100% 100%, rgba(255,104,164,0.92) 0%, rgba(255,104,164,0.26) 28%, rgba(255,104,164,0) 40%)",
    tabGlow: "0 0 18px 0 rgba(255,52,102,0.13)",
    railFill:
      "linear-gradient(162deg, rgba(255,106,143,0.4) 9.03%, rgba(255,52,102,0.1) 35.4%, rgba(255,52,102,0.08) 75.22%, rgba(255,127,158,0.25) 91.8%), linear-gradient(166deg, rgba(0,0,0,0) 22.8%, rgba(0,0,0,0.3) 68.91%, rgba(0,0,0,0) 95.92%)",
    railRing: "linear-gradient(162deg, #FF6B90 0%, rgba(255,52,102,0.35) 50%, #FF7F9E 100%)",
    railGlow: "0 0 4px 0 rgba(255,52,102,0.25)",
    genBg: "#FF3466",
    genText: "#ffffff",
    genShadow: "0 4px 22px -2px rgba(255,52,102,0.55)",
    genStrike: "rgba(255,255,255,0.35)",
    price: "#FF3466",
    presetTile:
      "linear-gradient(to bottom right, rgba(255,255,255,0.18), rgba(255,255,255,0.08), rgba(255,52,102,0.2))",
    logoFilter: "none",
    idleIcon: "rgba(255,255,255,0.65)",
  },
  fizz: {
    label: "Mono",
    pageBg: "oklch(0.17 0 0)",
    panelBg: "oklch(0.205 0 0 / 0.72)",
    railBg: "oklch(0.24 0 0 / 0.92)",
    popoverBg: "oklch(0.19 0 0)",
    surface: "oklch(0.205 0 0)",
    accentText: "linear-gradient(to right, #ffffff, #ffffff)",
    activeIcon: "#ffffff",
    word: "linear-gradient(to right, #ffffff, rgba(255,255,255,0.7))",
    chevron: "rgba(255,255,255,0.55)",
    tabRing:
      "radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.14) 30%, rgba(255,255,255,0) 46%), radial-gradient(120% 140% at 100% 100%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.14) 30%, rgba(255,255,255,0) 46%)",
    tabGlow: "0 0 0 0 transparent",
    railFill:
      "linear-gradient(162deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.08) 100%)",
    railRing:
      "linear-gradient(162deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.22) 100%)",
    railGlow: "0 0 0 0 transparent",
    genBg: "oklch(0.922 0 0)",
    genText: "oklch(0.205 0 0)",
    genShadow: "0 6px 22px -8px rgba(255,255,255,0.3)",
    genStrike: "rgba(0,0,0,0.3)",
    price: "#E52227",
    presetTile:
      "linear-gradient(to bottom right, rgba(255,255,255,0.16), rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
    logoFilter: "grayscale(1) brightness(1.15) opacity(0.85)",
    idleIcon: "rgba(255,255,255,0.6)",
  },
  // Red — Mono base (neutral surfaces + neutral WHITE active states), with brand
  // red #E52227 RESERVED for primary ACTION BUTTONS only (Generate / Start for
  // Free / Try Now / Send / Blank-Canvas +). Identical to Mono except the CTA
  // button color (white → red). Active rings/fills/headline/icons stay neutral.
  red: {
    label: "Red",
    pageBg: "oklch(0.17 0 0)",
    panelBg: "oklch(0.205 0 0 / 0.72)",
    railBg: "oklch(0.24 0 0 / 0.92)",
    popoverBg: "oklch(0.19 0 0)",
    surface: "oklch(0.205 0 0)",
    accentText: "linear-gradient(to right, #ffffff, #ffffff)",
    activeIcon: "#ffffff",
    word: "linear-gradient(to right, #ffffff, rgba(255,255,255,0.7))",
    chevron: "rgba(255,255,255,0.55)",
    tabRing:
      "radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.14) 30%, rgba(255,255,255,0) 46%), radial-gradient(120% 140% at 100% 100%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.14) 30%, rgba(255,255,255,0) 46%)",
    tabGlow: "0 0 0 0 transparent",
    railFill:
      "linear-gradient(162deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.08) 100%)",
    railRing:
      "linear-gradient(162deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.22) 100%)",
    railGlow: "0 0 0 0 transparent",
    genBg: "#E52227",
    genText: "#ffffff",
    genShadow: "0 4px 22px -2px rgba(229,34,39,0.5)",
    genStrike: "rgba(255,255,255,0.45)",
    price: "#E52227",
    presetTile:
      "linear-gradient(to bottom right, rgba(255,255,255,0.16), rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
    logoFilter: "grayscale(1) brightness(1.15) opacity(0.85)",
    idleIcon: "rgba(255,255,255,0.6)",
  },
};

export const EASE = "cubic-bezier(0,0,0.2,1)"; // tailwind ease-out; matches pollo's 0.3s
export const WORD_EASE = "cubic-bezier(0.22,1,0.36,1)"; // pollo headline carousel easing
/** Default Creative-mode model icon (Seedance 2.0). Placeholder asset until we host our own. */
export const MODEL_ICON =
  "https://videocdn.pollo.ai/web-cdn/pollo/production/cm3po9yyf0003oh0c2iyt8ajy/image/1754894158793-1e7ef687-c3c1-4f44-8b06-d044a8121f66.svg";
export const CONIC_BORDER =
  "conic-gradient(from 288deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0) 43%, rgba(255,255,255,0.05) 48%, rgba(255,255,255,0) 88%, rgba(255,255,255,0) 90%, rgba(255,255,255,0.10) 100%)";
export const RAIL_STEP = 40; // 38px button height + 2px gap
