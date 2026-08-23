import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StoryScreenplayDocument } from "@repo/shared/story-agent";
import { StoryScreenplayDocumentView } from "./story-screenplay-document-view";

describe("StoryScreenplayDocumentView", () => {
  it("renders only the ordered screenplay blocks supplied by the proposal", () => {
    const document: StoryScreenplayDocument = {
      schemaVersion: "story-screenplay-document-v1",
      blocks: [
        { kind: "heading", level: 1, text: "Night Gate" },
        { kind: "paragraph", text: "Rain crosses the empty road." },
        { kind: "heading", level: 2, text: "1. EXT. GATE – NIGHT" },
        { kind: "paragraph", text: "The guard opens the order." },
      ],
    };

    const html = renderToStaticMarkup(<StoryScreenplayDocumentView document={document} />);
    expect(html).toContain("<h1");
    expect(html).toContain("Night Gate");
    expect(html.indexOf("Night Gate")).toBeLessThan(html.indexOf("Rain crosses the empty road."));
    expect(html.indexOf("Rain crosses the empty road.")).toBeLessThan(
      html.indexOf("1. EXT. GATE – NIGHT")
    );
    expect(html).not.toContain("Scenes");
    expect(html).not.toContain("Branches");
    expect(html).not.toContain("sceneId");
  });
});
