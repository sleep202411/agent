import { describe, expect, it } from "vitest";

import {
  isStudioAgentDataPart,
  studioAgentAttachmentFilePart,
  studioAgentAttachmentPart,
  type StudioAgentAttachment,
} from "./transport-contract";

describe("Agent Platform UI transport contract", () => {
  it("renders product attachment metadata without leaking a provider or storage URL", () => {
    const part = studioAgentAttachmentPart(attachment());

    expect(part).toEqual({
      type: "data-studio-agent-attachment",
      id: ATTACHMENT_ID,
      data: attachment(),
    });
    expect(isStudioAgentDataPart(part, "studio-agent-attachment")).toBe(true);
  });

  it("addresses model-visible files by stable product identity", () => {
    const part = studioAgentAttachmentFilePart(attachment());

    expect(part).toEqual({
      type: "file",
      mediaType: "image/webp",
      filename: "reference.webp",
      url: `fizzdragon-media://${ATTACHMENT_ID}`,
    });
    expect(part.url).not.toMatch(/^https?:/);
  });
});

const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000006";

function attachment(): StudioAgentAttachment {
  return {
    type: "attachment",
    attachmentId: ATTACHMENT_ID,
    fileName: "reference.webp",
    mediaType: "image/webp",
    sizeBytes: 4096,
    status: "ready",
  };
}
