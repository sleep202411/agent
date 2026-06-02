# FizzDragon Mobile Design

Mobile is a new Expo / React Native surface. The old Vue / uni-app project is
the business-flow reference for first-pass mobile information architecture:
Story Square, project lists, creator center, and mine/profile should map back
to the old app's product modules. Do not copy its visual system, CSS, or
desktop page composition.

## Theme

- Use NativeWind for styling and Tailwind tokens for color, spacing, type, and
  radius.
- Mobile follows the current web product direction: dark-only. Do not expose a
  theme switch or branch UI off device light mode.
- `#E52227` is the brand accent, matching web's current primary token. Use it
  for primary actions, selected states, focus accents, destructive confirmation,
  and important status signals. Do not use it as a page background.
- Default surfaces are neutral and content-first: use a near-black root canvas,
  dark neutral panels, subtle white hairlines, off-white primary text, and muted
  gray secondary text.
- Cards and repeated items use radius `8px` or less unless a component has a
  specific interaction reason to be larger.
- Favor dense, task-oriented mobile screens over marketing-style hero layouts.

## App Structure

- The mobile app starts at authentication. Anonymous users see the login screen;
  they do not land on a public marketing/dashboard surface.
- Authenticated users enter a bottom-tab app shell. Tab pages should be compact
  app screens with native-style headers, lists, quick actions, and feed rows.
- Do not use desktop web patterns such as top nav bars, wide dashboards,
  oversized heroes, three-column stat grids, or sign-in CTA panels inside the
  tab shell.

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
