import { describe, expect, it } from "vitest";
import {
  TextGameChatResponseSchema,
  TextGameDetailSchema,
  TextGamePlaySessionSchema,
  TextGameSummaryListSchema,
} from "./text-game";

const content = {
  versionId: 12,
  versionNo: 3,
  name: "Mist Harbour",
  posterUrl: "https://cdn.example.com/poster.webp",
  synopsis: "The tide remembers.",
  bgmUrl: null,
  characters: [
    {
      id: 7,
      name: "Mara",
      intro: "A listener at the edge of the harbour.",
      avatarUrl: null,
      sortOrder: 0,
    },
  ],
  stillUrls: [],
};

describe("text-game wire contracts", () => {
  it("accepts the public detail shape when the private DOCX URL is omitted", () => {
    const parsed = TextGameDetailSchema.parse({
      gameId: "tg_abc123",
      status: "published",
      rejectReason: null,
      draftVersionId: 12,
      publishedVersionId: 12,
      publishedAt: "2026-08-09T12:00:00Z",
      offlineAt: null,
      createdAt: "2026-08-09T10:00:00Z",
      updatedAt: "2026-08-09T12:00:00Z",
      content,
    });

    expect(parsed.draftVersionId).toBe("12");
    expect(parsed.content.versionId).toBe("12");
    expect(parsed.content.worldviewDocxUrl).toBeNull();
    expect(parsed.content.characters[0]?.id).toBe("7");
  });

  it("normalizes list ids and nullable presentation fields", () => {
    expect(
      TextGameSummaryListSchema.parse([
        {
          gameId: "tg_abc123",
          name: null,
          posterUrl: null,
          synopsis: null,
          status: "draft",
          updatedAt: "2026-08-09T12:00:00Z",
        },
      ])[0]
    ).toMatchObject({ name: null, posterUrl: null, synopsis: null });
  });

  it("normalizes nullable character text to empty strings", () => {
    const parsed = TextGameDetailSchema.parse({
      gameId: "tg_abc123",
      status: "draft",
      rejectReason: null,
      draftVersionId: 12,
      publishedVersionId: null,
      publishedAt: null,
      offlineAt: null,
      createdAt: "2026-08-09T10:00:00Z",
      updatedAt: "2026-08-09T12:00:00Z",
      content: {
        ...content,
        characters: [
          {
            id: 8,
            name: null,
            intro: null,
            avatarUrl: null,
            sortOrder: 1,
          },
        ],
      },
    });

    expect(parsed.content.characters[0]).toMatchObject({ name: "", intro: "" });
  });

  it("normalizes nullable Java collection fields to empty arrays", () => {
    const parsed = TextGameDetailSchema.parse({
      gameId: "tg_abc123",
      status: "draft",
      rejectReason: null,
      draftVersionId: 12,
      publishedVersionId: null,
      publishedAt: null,
      offlineAt: null,
      createdAt: "2026-08-09T10:00:00Z",
      updatedAt: "2026-08-09T12:00:00Z",
      content: { ...content, characters: null, stillUrls: null },
    });

    expect(parsed.content.characters).toEqual([]);
    expect(parsed.content.stillUrls).toEqual([]);
  });

  it("accepts numeric and string message ids without unsafe number coercion", () => {
    const session = TextGamePlaySessionSchema.parse({
      sessionId: "ts_abc123",
      gameId: "tg_abc123",
      resumed: true,
      bgmUrl: null,
      stillUrls: [],
      startedAt: "2026-08-09T12:00:00Z",
      messages: [
        {
          id: 9007199254740991,
          role: "assistant",
          content: "The harbour wakes.",
          createdAt: "2026-08-09T12:00:01Z",
        },
      ],
    });
    const turn = TextGameChatResponseSchema.parse({
      sessionId: session.sessionId,
      userMessage: {
        id: "9007199254740993",
        role: "user",
        content: "I follow the bell.",
        createdAt: "2026-08-09T12:01:00Z",
      },
      assistantMessage: {
        id: "9007199254740994",
        role: "assistant",
        content: "The bell answers.",
        createdAt: "2026-08-09T12:01:01Z",
      },
    });

    expect(session.messages[0]?.id).toBe("9007199254740991");
    expect(turn.userMessage.id).toBe("9007199254740993");
  });

  it("rejects unknown lifecycle states", () => {
    expect(() =>
      TextGameSummaryListSchema.parse([
        {
          gameId: "tg_abc123",
          name: "Mist Harbour",
          posterUrl: null,
          synopsis: null,
          status: "approved",
          updatedAt: "2026-08-09T12:00:00Z",
        },
      ])
    ).toThrow();
  });
});
