import { z } from "zod";
import { jinlingFilmClipV2 } from "./media-release-v2";

/**
 * 《金陵入梦：无字来客》v2 三分钟版 剧情数据源。
 *
 * Same interaction shape as v1 (4 chapters, C1=3 / C2=3 / C3=4 / final=4),
 * but the endings are DETERMINISTIC — each final choice maps to exactly one
 * ending, no scoring. Reactions are per-choice clips that play then advance.
 * Video urls are placeholders under the immutable `s01/v2` release; the 26
 * clip ids match docs/jinling-rumeng/20-THREE-MINUTE-VIDEO-PROMPT-PACK.md.
 */

export const JINLING_V2_CHAPTER_IDS = ["c1", "c2", "c3", "c4"] as const;
export const JINLING_V2_ENDING_IDS = ["e01", "e02", "e03", "e04"] as const;

export type JinlingV2ChapterId = (typeof JINLING_V2_CHAPTER_IDS)[number];
export type JinlingV2EndingId = (typeof JINLING_V2_ENDING_IDS)[number];

/** A single graph choice: play the reaction clip, then go to a chapter OR end. */
export type JinlingV2Choice = {
  choiceId: string;
  /** Set on C1/C2/C3 (branch back to the shared main line). */
  nextChapterId?: JinlingV2ChapterId;
  /** Set on the final chapter (deterministic ending). */
  endingId?: JinlingV2EndingId;
  reactionVideo: string;
};

export type JinlingV2Clip = { clipId: string; video: string };

export type JinlingV2Chapter = {
  chapterId: JinlingV2ChapterId;
  /** The chapter's main-line clips, played in order before choices appear. */
  clips: readonly JinlingV2Clip[];
  choices: readonly JinlingV2Choice[];
  /**
   * Optional silent loop bed shown while the player deliberates. Absent → the
   * player tail-loops the last main clip (v1 pattern), so WAIT videos are not
   * a hard dependency for a first playable cut.
   */
  waitVideo?: string;
};

const clips = (...ids: string[]): readonly JinlingV2Clip[] =>
  ids.map((clipId) => ({ clipId, video: jinlingFilmClipV2(clipId) }));

export const JINLING_V2_CHAPTERS: readonly JinlingV2Chapter[] = [
  {
    chapterId: "c1",
    clips: clips("p00-ledger-opening", "s01-gate-arrival"),
    waitVideo: jinlingFilmClipV2("w01-identity-wait"),
    choices: [
      {
        choiceId: "brocade",
        nextChapterId: "c2",
        reactionVideo: jinlingFilmClipV2("c1-r01-brocade"),
      },
      {
        choiceId: "oldSeal",
        nextChapterId: "c2",
        reactionVideo: jinlingFilmClipV2("c1-r02-old-seal"),
      },
      {
        choiceId: "medicinePouch",
        nextChapterId: "c2",
        reactionVideo: jinlingFilmClipV2("c1-r03-medicine-pouch"),
      },
    ],
  },
  {
    chapterId: "c2",
    clips: clips("s02-corridor-crisis"),
    waitVideo: jinlingFilmClipV2("w02-corridor-wait"),
    choices: [
      {
        choiceId: "protectDaiyu",
        nextChapterId: "c3",
        reactionVideo: jinlingFilmClipV2("c2-r01-protect-daiyu"),
      },
      {
        choiceId: "steadyLantern",
        nextChapterId: "c3",
        reactionVideo: jinlingFilmClipV2("c2-r02-steady-lantern"),
      },
      {
        choiceId: "protectLetter",
        nextChapterId: "c3",
        reactionVideo: jinlingFilmClipV2("c2-r03-protect-letter"),
      },
    ],
  },
  {
    chapterId: "c3",
    clips: clips("s03-jiamu-reunion", "s03-xifeng-boundary", "s04-baoyu-arrival", "s04-jade-throw"),
    choices: [
      {
        choiceId: "catchJade",
        nextChapterId: "c4",
        reactionVideo: jinlingFilmClipV2("c3-r01-catch-jade"),
      },
      {
        choiceId: "shieldDaiyu",
        nextChapterId: "c4",
        reactionVideo: jinlingFilmClipV2("c3-r02-shield-daiyu"),
      },
      {
        choiceId: "callHousehold",
        nextChapterId: "c4",
        reactionVideo: jinlingFilmClipV2("c3-r03-call-household"),
      },
      {
        choiceId: "observePattern",
        nextChapterId: "c4",
        reactionVideo: jinlingFilmClipV2("c3-r04-observe-pattern"),
      },
    ],
  },
  {
    chapterId: "c4",
    clips: clips("s05-daiyu-night-visit", "s05-letter-reveal"),
    waitVideo: jinlingFilmClipV2("w03-final-choice-wait"),
    choices: [
      {
        choiceId: "spring",
        endingId: "e01",
        reactionVideo: jinlingFilmClipV2("e01-spring-with-daiyu"),
      },
      { choiceId: "name", endingId: "e02", reactionVideo: jinlingFilmClipV2("e02-name-in-house") },
      {
        choiceId: "memory",
        endingId: "e03",
        reactionVideo: jinlingFilmClipV2("e03-memory-shared"),
      },
      {
        choiceId: "unwritten",
        endingId: "e04",
        reactionVideo: jinlingFilmClipV2("e04-future-unwritten"),
      },
    ],
  },
] as const;

export const JinlingV2StoryProgressSchema = z
  .object({
    version: z.literal(3),
    chapterId: z.enum(JINLING_V2_CHAPTER_IDS),
    history: z.array(z.string().trim().min(1)).max(8),
    endingId: z.enum(JINLING_V2_ENDING_IDS).nullable(),
  })
  .strict();

export type JinlingV2StoryProgress = z.infer<typeof JinlingV2StoryProgressSchema>;

export function createJinlingV2StoryProgress(): JinlingV2StoryProgress {
  return { version: 3, chapterId: "c1", history: [], endingId: null };
}

export function jinlingV2StoryChapter(chapterId: JinlingV2ChapterId): JinlingV2Chapter {
  const chapter = JINLING_V2_CHAPTERS.find((candidate) => candidate.chapterId === chapterId);
  if (!chapter) throw new Error(`Missing Jinling v2 chapter ${chapterId}`);
  return chapter;
}

export function jinlingV2EndingVideo(endingId: JinlingV2EndingId): string {
  return jinlingFilmClipV2(
    {
      e01: "e01-spring-with-daiyu",
      e02: "e02-name-in-house",
      e03: "e03-memory-shared",
      e04: "e04-future-unwritten",
    }[endingId]
  );
}

export function jinlingV2StoryStorageKey(sessionId: string): string {
  return `fizzdragon.jinling.story-film.v3.${sessionId}`;
}
