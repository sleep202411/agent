// Regenerate from the same installed Tiptap data as Web's Notion-like editor.
// Run from repo root: node apps/mobile/scripts/generate-document-emoji.mjs
import { gitHubEmojis } from "@tiptap/extension-emoji";
import { writeFileSync } from "node:fs";
const emojis = Object.fromEntries(
  gitHubEmojis
    .filter((item) => !item.name.includes("regional") && item.emoji)
    .flatMap((item) => [item.name, ...item.shortcodes].map((name) => [name, item.emoji]))
);
writeFileSync(
  new URL("../src/features/services/document-data/emoji.json", import.meta.url),
  JSON.stringify(emojis, null, 2) + "\n"
);
