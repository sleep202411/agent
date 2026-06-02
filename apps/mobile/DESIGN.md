# FizzDragon Mobile Design

Mobile is a new Expo / React Native surface. The old Vue / uni-app project is
only a feature and API reference; do not copy its visual system, layout rhythm,
or page composition.

## Theme

- Use NativeWind for styling and Tailwind tokens for color, spacing, type, and
  radius.
- `#E52227` is the brand accent. Use it for primary actions, selected states,
  focus accents, destructive confirmation, and important status signals. Do not
  use it as a page background.
- Default surfaces are neutral and content-first: light mode uses warm white
  canvas and white panels; dark mode uses near-black canvas and dark neutral
  panels.
- Cards and repeated items use radius `8px` or less unless a component has a
  specific interaction reason to be larger.
- Favor dense, task-oriented mobile screens over marketing-style hero layouts.

## Copy

English remains the source language. Chinese text belongs in locale resources,
not inline TSX.

## Auth Forms

- Keep account forms compact and task-first. Login is a product screen, not a
  marketing hero.
- Required fields, disabled submit, submitting state, backend error messages,
  and deterministic back navigation must be visible.
- Backend errors should be shown directly unless the upstream message is empty
  or unsafe.

## Sources

- Root brand rules: `../../DESIGN.md`
- Token source: `src/config/theme-tokens.json`
- NativeWind implementation: `tailwind.config.js`
