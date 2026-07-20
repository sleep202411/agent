import { z } from "zod";
import { jinlingFilmChapter, jinlingFilmClip } from "./media-release";

export const JINLING_STORY_CHAPTER_IDS = ["c1", "c2", "c3", "c4"] as const;
export const JINLING_ENDING_IDS = ["e01", "e02", "e03", "e04", "e05"] as const;

export type JinlingStoryChapterId = (typeof JINLING_STORY_CHAPTER_IDS)[number];
export type JinlingEndingId = (typeof JINLING_ENDING_IDS)[number];
export type JinlingFinalAction = "daiyu" | "xifeng" | "keep" | "burn";

export type JinlingStoryScores = {
  trust: number;
  standing: number;
  insight: number;
  leverage: number;
  baoyu: number;
  credibility: number;
};

export type JinlingStoryChoice = {
  choiceId: string;
  nextChapterId?: JinlingStoryChapterId;
  finalAction?: JinlingFinalAction;
  effects: Partial<JinlingStoryScores>;
  reactionVideo: string;
};

export type JinlingStoryClip = {
  clipId: string;
  video: string;
};

export type JinlingStoryChapter = {
  chapterId: JinlingStoryChapterId;
  poster: string;
  video: string;
  clips: readonly JinlingStoryClip[];
  choices: readonly JinlingStoryChoice[];
};

const clips = (...ids: string[]): readonly JinlingStoryClip[] =>
  ids.map((clipId) => ({ clipId, video: jinlingFilmClip(clipId) }));

export const EMPTY_JINLING_STORY_SCORES: JinlingStoryScores = {
  trust: 0,
  standing: 0,
  insight: 0,
  leverage: 0,
  baoyu: 0,
  credibility: 0,
};

export const JINLING_STORY_CHAPTERS: readonly JinlingStoryChapter[] = [
  {
    chapterId: "c1",
    video: jinlingFilmChapter("c1"),
    poster: "/jinling-rumeng/preview/story/sc01-letter.png",
    clips: clips(
      "a1-s01-carriage-wake",
      "a1-s02-daiyu-sedan",
      "a1-s03-gate-arrival",
      "a1-s04-gate-question"
    ),
    choices: [
      {
        choiceId: "oldTrust",
        nextChapterId: "c2",
        effects: { credibility: 2, standing: 1 },
        reactionVideo: jinlingFilmClip("c1-r01-old-trust"),
      },
      {
        choiceId: "daiyuRoad",
        nextChapterId: "c2",
        effects: { trust: -1, credibility: -1 },
        reactionVideo: jinlingFilmClip("c1-r02-daiyu-road"),
      },
      {
        choiceId: "keepsake",
        nextChapterId: "c2",
        effects: { credibility: 1, insight: 1 },
        reactionVideo: jinlingFilmClip("c1-r03-keepsake"),
      },
    ],
  },
  {
    chapterId: "c2",
    video: jinlingFilmChapter("c2"),
    poster: "/jinling-rumeng/preview/story/sc03-lantern.png",
    clips: clips("a2-s01-corridor-entry", "a2-s02-wind-crisis"),
    choices: [
      {
        choiceId: "protectDaiyu",
        nextChapterId: "c3",
        effects: { trust: 2 },
        reactionVideo: jinlingFilmClip("c2-r01-protect-daiyu"),
      },
      {
        choiceId: "steadyLantern",
        nextChapterId: "c3",
        effects: { trust: 1, standing: 1 },
        reactionVideo: jinlingFilmClip("c2-r02-steady-lantern"),
      },
      {
        choiceId: "protectLetter",
        nextChapterId: "c3",
        effects: { insight: 2 },
        reactionVideo: jinlingFilmClip("c2-r03-protect-letter"),
      },
    ],
  },
  {
    chapterId: "c3",
    video: jinlingFilmChapter("c3"),
    poster: "/jinling-rumeng/preview/story/sc04-jiamu.png",
    clips: clips(
      "a2-s03-jiamu-embrace",
      "a2-s04-jiamu-comfort",
      "a2-s05-jiamu-turns",
      "a2-s06-letter-to-xifeng",
      "a3-s01-xifeng-closes-door",
      "a3-s02-xifeng-date-trap",
      "a3-s03-xifeng-seal",
      "a3-s04-baoyu-formal-entry",
      "a3-s05-baoyu-home-return",
      "a3-s06-baoyu-recognition",
      "a3-s07-ask-about-jade",
      "a3-s08-jade-throw"
    ),
    choices: [
      {
        choiceId: "catchJade",
        nextChapterId: "c4",
        effects: { standing: 2, baoyu: 2 },
        reactionVideo: jinlingFilmClip("c3-r01-catch-jade"),
      },
      {
        choiceId: "shieldDaiyu",
        nextChapterId: "c4",
        effects: { trust: 2, standing: 1 },
        reactionVideo: jinlingFilmClip("c3-r02-shield-daiyu"),
      },
      {
        choiceId: "callJiamu",
        nextChapterId: "c4",
        effects: { standing: 2, leverage: 1 },
        reactionVideo: jinlingFilmClip("c3-r03-call-jiamu"),
      },
      {
        choiceId: "letFall",
        nextChapterId: "c4",
        effects: { insight: 1 },
        reactionVideo: jinlingFilmClip("c3-r04-let-fall"),
      },
    ],
  },
  {
    chapterId: "c4",
    video: jinlingFilmChapter("c4"),
    poster: "/jinling-rumeng/preview/story/sc09-daiyu-night.png",
    clips: clips(
      "a4-s01-daiyu-night-arrival",
      "a4-s02-daiyu-remembers",
      "a4-s03-letter-reveal",
      "a4-s04-daiyu-refuses-fate",
      "a4-s05-seal-awakens",
      "a4-s06-letter-choice-wait"
    ),
    choices: [
      {
        choiceId: "daiyu",
        finalAction: "daiyu",
        effects: { trust: 1 },
        reactionVideo: jinlingFilmClip("c4-e01-trust-daiyu"),
      },
      {
        choiceId: "xifeng",
        finalAction: "xifeng",
        effects: { leverage: 1 },
        reactionVideo: jinlingFilmClip("c4-e02-hand-xifeng"),
      },
      {
        choiceId: "keep",
        finalAction: "keep",
        effects: { insight: 1 },
        reactionVideo: jinlingFilmClip("c4-e03-keep-letter"),
      },
      {
        choiceId: "burn",
        finalAction: "burn",
        effects: {},
        reactionVideo: jinlingFilmClip("c4-e04-destroy-leave"),
      },
    ],
  },
] as const;

const StoryScoresSchema = z
  .object({
    trust: z.number().int(),
    standing: z.number().int(),
    insight: z.number().int(),
    leverage: z.number().int(),
    baoyu: z.number().int(),
    credibility: z.number().int(),
  })
  .strict();

export const JinlingStoryProgressSchema = z
  .object({
    version: z.literal(2),
    chapterId: z.enum(JINLING_STORY_CHAPTER_IDS),
    scores: StoryScoresSchema,
    history: z.array(z.string().trim().min(1)).max(8),
    endingId: z.enum(JINLING_ENDING_IDS).nullable(),
  })
  .strict();

export type JinlingStoryProgress = z.infer<typeof JinlingStoryProgressSchema>;

export function createJinlingStoryProgress(): JinlingStoryProgress {
  return {
    version: 2,
    chapterId: "c1",
    scores: { ...EMPTY_JINLING_STORY_SCORES },
    history: [],
    endingId: null,
  };
}

export function applyJinlingStoryEffects(
  scores: JinlingStoryScores,
  effects: Partial<JinlingStoryScores>
): JinlingStoryScores {
  return {
    trust: scores.trust + (effects.trust ?? 0),
    standing: scores.standing + (effects.standing ?? 0),
    insight: scores.insight + (effects.insight ?? 0),
    leverage: scores.leverage + (effects.leverage ?? 0),
    baoyu: scores.baoyu + (effects.baoyu ?? 0),
    credibility: scores.credibility + (effects.credibility ?? 0),
  };
}

export function resolveJinlingEnding(
  scores: JinlingStoryScores,
  finalAction: JinlingFinalAction
): JinlingEndingId {
  if (finalAction === "burn") return "e04";
  if (finalAction === "xifeng") return "e02";
  if (finalAction === "keep") return scores.insight >= 2 ? "e03" : "e05";
  return scores.trust >= 3 ? "e01" : "e05";
}

export function jinlingStoryChapter(chapterId: JinlingStoryChapterId): JinlingStoryChapter {
  const chapter = JINLING_STORY_CHAPTERS.find((candidate) => candidate.chapterId === chapterId);
  if (!chapter) throw new Error(`Missing Jinling film chapter ${chapterId}`);
  return chapter;
}

export function endingVideo(endingId: JinlingEndingId): string {
  return jinlingFilmClip(
    {
      e01: "c4-e01-trust-daiyu",
      e02: "c4-e02-hand-xifeng",
      e03: "c4-e03-keep-letter",
      e04: "c4-e04-destroy-leave",
      e05: "c4-e05-unwritten",
    }[endingId]
  );
}

export function jinlingStoryStorageKey(sessionId: string): string {
  return `fizzdragon.jinling.story-film.v2.${sessionId}`;
}
