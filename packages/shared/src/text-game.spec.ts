import { describe, expect, it } from "vitest";
import {
  TextGameBossActionSchema,
  TextGameChatResponseSchema,
  TextGameDetailSchema,
  TextGameIdSchema,
  TextGamePlaySessionSchema,
  TextGameSessionIdSchema,
  TextGameSummaryListSchema,
  isTextGameBossActionAllowed,
  isTextGameCreatorActionAllowed,
  isTextGameEditableByCreator,
  textGameStatusAfterBossAction,
  textGameStatusAfterCreatorAction,
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
      gameId: "tg_0123456789abcdef",
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
          gameId: "tg_0123456789abcdef",
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
      gameId: "tg_0123456789abcdef",
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
      gameId: "tg_0123456789abcdef",
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
      sessionId: "ts_0123456789abcdef",
      gameId: "tg_0123456789abcdef",
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
          gameId: "tg_0123456789abcdef",
          name: "Mist Harbour",
          posterUrl: null,
          synopsis: null,
          status: "approved",
          updatedAt: "2026-08-09T12:00:00Z",
        },
      ])
    ).toThrow();
  });

  it("requires a non-empty reason when an operator rejects a work", () => {
    expect(TextGameBossActionSchema.parse({ action: "approve" })).toEqual({ action: "approve" });
    expect(TextGameBossActionSchema.parse({ action: "force_offline" })).toEqual({
      action: "force_offline",
    });
    expect(
      TextGameBossActionSchema.parse({ action: "reject", reason: "  Cover is misleading.  " })
    ).toEqual({ action: "reject", reason: "Cover is misleading." });
    expect(() => TextGameBossActionSchema.parse({ action: "reject", reason: "   " })).toThrow();
  });

  it("enforces the public identifier formats", () => {
    expect(TextGameIdSchema.parse("tg_0123456789abcdef")).toBe("tg_0123456789abcdef");
    expect(TextGameSessionIdSchema.parse("ts_0123456789abcdef")).toBe("ts_0123456789abcdef");
    expect(() => TextGameIdSchema.parse("tg_short")).toThrow();
    expect(() => TextGameSessionIdSchema.parse("tg_0123456789abcdef")).toThrow();
  });

  it("keeps creator capabilities aligned with the Java status machine", () => {
    expect(isTextGameEditableByCreator("draft")).toBe(true);
    expect(isTextGameEditableByCreator("reviewing")).toBe(false);
    expect(isTextGameCreatorActionAllowed("draft", "submit")).toBe(true);
    expect(isTextGameCreatorActionAllowed("offline", "submit")).toBe(true);
    expect(isTextGameCreatorActionAllowed("published", "submit")).toBe(true);
    expect(isTextGameCreatorActionAllowed("reviewing", "submit")).toBe(false);
    expect(isTextGameCreatorActionAllowed("reviewing", "offline")).toBe(true);
    expect(isTextGameCreatorActionAllowed("published", "offline")).toBe(true);
    expect(isTextGameCreatorActionAllowed("draft", "offline")).toBe(false);
    expect(textGameStatusAfterCreatorAction("submit")).toBe("reviewing");
    expect(textGameStatusAfterCreatorAction("offline")).toBe("offline");
  });

  it("keeps moderation capabilities aligned with the Java status machine", () => {
    expect(isTextGameBossActionAllowed("reviewing", "approve")).toBe(true);
    expect(isTextGameBossActionAllowed("reviewing", "reject")).toBe(true);
    expect(isTextGameBossActionAllowed("published", "force_offline")).toBe(true);
    expect(isTextGameBossActionAllowed("reviewing", "force_offline")).toBe(true);
    expect(isTextGameBossActionAllowed("draft", "approve")).toBe(false);
    expect(isTextGameBossActionAllowed("offline", "force_offline")).toBe(false);
    expect(textGameStatusAfterBossAction("approve")).toBe("published");
    expect(textGameStatusAfterBossAction("reject")).toBe("draft");
    expect(textGameStatusAfterBossAction("force_offline")).toBe("offline");
  });
});
