# App Story Agent H5

Read `../../DESIGN.md` for FizzDragon brand, localization and error reporting.
This surface is dedicated to App interactive-film production. Official Harness
owns conversation layout, input, attachments, Markdown, message actions,
preferences and panels; extend its public slots without forking vendor UI.

- Keep the existing dark, neutral, borderless presentation. Red identifies the
  deliberate primary action; avoid decorative surfaces or a welcome logo.
- Hide planner model selection and developer configuration. Video model choices
  belong only in the media quote card; confirmation precedes paid generation.
- Keep text conversation free. Do not put spending authorization in the composer.
- Preserve image placeholders through completion. Show one aggregate video
  progress/result card with real reference previews and timeline progress;
  individual clips belong in the media panel. Label references as previews.
- A playable result is an interactive story with choices and reachable endings
  unless the user explicitly requested linear video. Reuse the shared player.
- Keep cards responsive and actions grouped. Controls use a 14px radius; neutral
  result cards use 16px. Keep upstream error details, focus states and reduced
  motion behavior accessible.
- Product copy uses the canonical `apps/web/messages/{en-US,zh-CN,zh-HK}.json`.
  Translations are build inputs, not a dependency on Web or Studio at runtime.
- Server data stays in TanStack Query; local UI state stays in Harness stores or
  component state. Never copy production state into a second client store.

`ui/style.css` owns product extension styles. `ui/player.css` includes only the
shared player's Tailwind utilities, without preflight affecting Harness.
