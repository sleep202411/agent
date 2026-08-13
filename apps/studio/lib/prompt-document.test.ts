import { describe, expect, it } from "vitest";
import {
  promptDocumentToText,
  promptMentionParts,
  promptTextToDocument,
  type PromptMentionItem,
} from "./prompt-document";

const mentions: PromptMentionItem[] = [
  {
    id: "image-1",
    kind: "image",
    label: "Image1",
    assetId: "asset-1",
    bytes: 2_097_152,
    width: 1920,
    height: 1080,
  },
  { id: "skill-1", kind: "skill", label: "Cinematic Lighting" },
];

describe("prompt document mentions", () => {
  it("round-trips @ references and / Skills without flattening their kinds", () => {
    const value = "Use @Image1 with /Cinematic Lighting";
    const document = promptTextToDocument(value, mentions);

    expect(document.content?.[0]?.content?.map((node) => node.attrs?.kind ?? node.text)).toEqual([
      "Use ",
      "image",
      " with ",
      "skill",
    ]);
    expect(promptDocumentToText(document)).toBe(value);
    expect(document.content?.[0]?.content?.[1]?.attrs).toMatchObject({
      assetId: "asset-1",
      bytes: 2_097_152,
      width: 1920,
      height: 1080,
    });
  });

  it("does not treat ratios or legacy @Skill text as installed Skill entities", () => {
    const value = "Use 16/9 framing, not @Cinematic Lighting";
    expect(promptMentionParts(value, mentions).some((part) => part.mention?.kind === "skill")).toBe(
      false
    );
    expect(promptDocumentToText(promptTextToDocument(value, mentions))).toBe(value);
  });
});
