/**
 * Canonical Script document for proposal review — same blocks PC shows in
 * `StoryScreenplayDocumentView`. Do not import `@repo/shared/story-agent`
 * (Zod graph is too large for Metro); read the persisted document, and only
 * rebuild from `screenplay` when older durable runs omitted it.
 */

export type StoryScreenplayDocumentBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string };

type StoryScreenplayProposalSlice = {
  title?: string;
  screenplay?: {
    title?: string;
    logline?: string;
    synopsis?: string;
    storyLanguage?: string;
    scenes?: unknown[];
    characters?: unknown[];
  };
  document?: {
    blocks?: unknown[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDocumentBlock(value: unknown): value is StoryScreenplayDocumentBlock {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) return false;
  if (value.kind === "paragraph") return true;
  return value.kind === "heading" && (value.level === 1 || value.level === 2 || value.level === 3);
}

function localizedStoryText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  const pick =
    (typeof value["en-US"] === "string" && value["en-US"]) ||
    (typeof value["zh-CN"] === "string" && value["zh-CN"]) ||
    (typeof value["zh-HK"] === "string" && value["zh-HK"]) ||
    Object.values(value).find((item) => typeof item === "string");
  return typeof pick === "string" ? pick.trim() : "";
}

function pushParagraph(blocks: StoryScreenplayDocumentBlock[], text: string) {
  const trimmed = text.trim();
  if (trimmed) blocks.push({ kind: "paragraph", text: trimmed });
}

/** Exact creator-visible Script for this proposal — persisted document first. */
export function storyScreenplayDocumentBlocks(
  proposal: StoryScreenplayProposalSlice
): StoryScreenplayDocumentBlock[] {
  const persisted = Array.isArray(proposal.document?.blocks)
    ? proposal.document.blocks.filter(isDocumentBlock)
    : [];
  if (persisted.length > 0) return persisted;
  return buildBlocksFromScreenplay(proposal);
}

function buildBlocksFromScreenplay(
  proposal: StoryScreenplayProposalSlice
): StoryScreenplayDocumentBlock[] {
  const screenplay = proposal.screenplay;
  if (!screenplay) return [];

  const title = screenplay.title?.trim() || proposal.title?.trim() || "";
  const storyLanguage = screenplay.storyLanguage?.trim() ?? "";
  const labels =
    storyLanguage === "zh-CN" || storyLanguage === "zh-HK"
      ? { synopsis: "故事梗概", characters: "角色" }
      : { synopsis: "Synopsis", characters: "Characters" };
  const scenes = Array.isArray(screenplay.scenes) ? screenplay.scenes : [];
  const characters = Array.isArray(screenplay.characters) ? screenplay.characters : [];
  const sceneNames = new Map<string, string>();
  for (const scene of scenes) {
    if (!isRecord(scene) || typeof scene.nodeId !== "string") continue;
    const name = typeof scene.name === "string" ? scene.name.trim() : "";
    const heading = typeof scene.heading === "string" ? scene.heading.trim() : "";
    sceneNames.set(scene.nodeId, name || heading || scene.nodeId);
  }

  const blocks: StoryScreenplayDocumentBlock[] = [];
  if (title) blocks.push({ kind: "heading", level: 1, text: title });
  if (screenplay.logline?.trim()) pushParagraph(blocks, screenplay.logline);
  if (screenplay.synopsis?.trim()) {
    blocks.push({ kind: "heading", level: 2, text: labels.synopsis });
    pushParagraph(blocks, screenplay.synopsis);
  }
  if (characters.length > 0) {
    blocks.push({ kind: "heading", level: 2, text: labels.characters });
    for (const character of characters) {
      if (!isRecord(character)) continue;
      const displayName =
        localizedStoryText(character.name) ||
        (typeof character.id === "string" ? character.id : "");
      const summary = typeof character.summary === "string" ? character.summary.trim() : "";
      if (displayName) {
        pushParagraph(blocks, summary ? `${displayName} — ${summary}` : displayName);
      }
    }
  }

  scenes.forEach((scene, index) => {
    if (!isRecord(scene)) return;
    const heading = typeof scene.heading === "string" ? scene.heading.trim() : "";
    if (heading) {
      blocks.push({ kind: "heading", level: 2, text: `${index + 1}. ${heading}` });
    }
    if (typeof scene.action === "string") pushParagraph(blocks, scene.action);
    const dialogue = Array.isArray(scene.dialogue) ? scene.dialogue : [];
    for (const line of dialogue) {
      if (!isRecord(line)) continue;
      if (typeof line.speaker === "string") pushParagraph(blocks, line.speaker.toUpperCase());
      if (typeof line.parenthetical === "string" && line.parenthetical.trim()) {
        pushParagraph(blocks, `(${line.parenthetical.trim()})`);
      }
      if (typeof line.text === "string") pushParagraph(blocks, line.text);
    }
    const exit = isRecord(scene.exit) ? scene.exit : null;
    if (exit?.kind !== "choice" || !Array.isArray(exit.choices)) return;
    pushParagraph(blocks, localizedStoryText(exit.prompt));
    for (const choice of exit.choices) {
      if (!isRecord(choice)) continue;
      const label = localizedStoryText(choice.label);
      const nextId = typeof choice.nextNodeId === "string" ? choice.nextNodeId : "";
      const nextName = sceneNames.get(nextId) ?? nextId;
      if (label) pushParagraph(blocks, `• ${label} → ${nextName}`);
    }
  });

  return blocks;
}
