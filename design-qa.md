# Crew Asset Center — Design QA

## Evidence

- Product source visual:
  `/Users/isaac/.codex/generated_images/019fa06b-79db-7113-9fc9-bf415a771d7a/call_CnYRUYYu16OGoJpIjHW2vblP.png`
- Reported interaction state:
  `/var/folders/23/12w602gn55b1d801mymktkch0000gn/T/codex-clipboard-ab102dcd-26dd-43ba-abd1-1759f94cd362.png`
- Live implementation:
  `http://localhost:9527/zh-CN/crews/281FUpPcQawL/workspace?tab=assets`
- State: three-column list view with the selected storyboard PDF
  rendered in the in-page right preview/detail region.

## Findings and Comparison History

### Iteration 1

- P1 — File opening was incorrectly implemented as a right-side drawer.
  - Impact: preview and metadata/permissions were conflated, and the
    interaction did not match familiar cloud-drive behavior.

### Iteration 2

- P1 — Replacing the drawer with a centered modal was still the wrong
  spatial model.
  - Impact: opening a file interrupted the asset-browsing context rather
    than letting the user keep scanning the list.

### Iteration 3

- P0: none.
- P1: none.
- P2: none.
- Desktop uses a stable three-column layout: folders, file list, and
  preview/details.
- Selecting a file updates the right region in place.
- Closing the right region expands the list; the eye control restores it.
- No drawer, sheet, or centered dialog is used.

## Required Fidelity Surfaces

- Fonts and typography: existing FizzDragon workspace typography,
  weights, truncation, and compact UI sizing are preserved.
- Spacing and layout rhythm: the right region is a 340 px in-page column
  with a compact file header, large preview, viewer toolbar, tabs, and
  permission content.
- Colors and visual tokens: zero-chroma dark surfaces and deliberate
  brand-red selection/accent match the source.
- Image quality and asset fidelity: the generated storyboard sheet is
  rendered as a real raster asset with `object-contain`; no placeholder
  or CSS-drawn artwork is used.
- Copy and content: asset name, version, size, pagination, file type,
  modified time, and viewer actions remain visible without competing
  with the artwork.

## Interaction and Engineering QA

- Browser: single-click selected `EP01_Scrt_010_board_v02.pdf` and
  updated the named right region to that file.
- Browser: `rightPaneCount: 1`, `selectedFile: true`.
- Browser: combined sheet/dialog count remained `0`.
- Browser: the close and eye controls remove and restore the in-page
  region without an overlay.
- Browser console errors: none.
- `npm run check-types` — passed.
- Targeted ESLint — passed.
- Targeted Vitest — 2 tests passed for selection-driven right preview,
  close/reopen behavior, and absence of overlays.

## Follow-up Polish

- P3: when real PDF/video backends arrive, connect zoom, playback, and
  fullscreen controls to their production viewers.

final result: passed
