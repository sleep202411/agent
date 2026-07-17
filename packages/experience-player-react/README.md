# Experience Player React

Production React host for `@repo/experience-engine`. It is the single player
implementation used by both the private Studio playtest and the public Web
player.

## Boundary

- `@repo/experience-engine` remains deterministic and headless.
- This package owns browser media, Web Audio, theme integrity loading,
  responsive orientation, spatial gestures, and core renderer UI.
- Host apps inject localized copy and may inject a custom theme loader. The
  package does not import Next.js, an app alias, or an app i18n runtime.
- Host apps own data access and authorization. The player only accepts a
  Runtime Manifest and never knows whether it came from a private draft,
  frozen build, or published CDN release.

Tailwind v4 host stylesheets must register `src/` with `@source`; both Web and
Studio do this in their global stylesheet.
