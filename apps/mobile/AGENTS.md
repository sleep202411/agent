# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Mobile release branches (2026-09-30)

- Start each new Mobile feature from the latest official `main` on a separate
  feature branch. Finish and validate the whole feature, then coordinate release
  scope before merging to `main`; do not continuously merge partial batches.
- Continue joint Mobile development with the Mobile developer on
  `feat/mobile-2.4.0-scrolling-screen`. Fetch and integrate each other's commits
  before pushing; never force-push, reset or discard a colleague's work.
- `feat/mobile-2.4.0-scrolling-screen` owns deferred discovery,
  personal-video publishing, service orders, inbox/conversations and service
  management. Keep these out of the current payment release until approved.
- Keep unfinished work on this shared feature branch, including its routes,
  entry points, supporting modules and tests. Do not sync partial work into
  `main` or `develop`. Merge to `main` only after the entire feature is complete,
  validated and explicitly approved for release.
- `feat/mobile-2.3.1-pay` is owned by the Mobile release developer. Do not modify
  or push it without a new explicit instruction overriding this restriction.
