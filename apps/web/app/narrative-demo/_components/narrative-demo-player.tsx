"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  IconArrowLeft,
  IconArrowRight,
  IconFlag,
  IconFingerprint,
  IconMapPin,
  IconPencil,
  IconPlayerPlay,
  IconSend,
  IconSparkles,
  IconUsersGroup,
  IconWand,
  IconX,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { setLanguage, useTranslations } from "@/src/i18n/i18n";

type SetupKey = "name" | "identity" | "details";

type CharacterAssetId = "linFeng" | "brother" | "receptionTeacher" | "securityGuard";

type PlotId = "plotA" | "plotB";

type EndingId = "truth" | "intervention" | "coverup";

type TurnNextState = "stay" | "advancePlot" | "ending";

type SetupStep = {
  key: SetupKey;
  labelKey: string;
  placeholderKey: string;
  optional?: boolean;
};

type MessageKind = "narrator" | "player" | "system";

type StoryEntry = {
  id: string;
  kind: MessageKind;
  body: string;
  meta?: string;
  clueIds?: string[];
  media?: StoryMedia;
  speakerId?: CharacterAssetId;
};

type Clue = {
  id: string;
  title: string;
  summary: string;
  type: string;
};

type StoryMedia = {
  description: string;
  kind: "video";
  poster: string;
  source: string;
  title: string;
};

type SoundEffectId = "doorHardShut";

type SoundEffect = {
  id: SoundEffectId;
  source: string;
  trigger: RegExp;
  volume: number;
};

type RuntimeStory = {
  id: PlotId;
  title: string;
  nodeLabel: string;
  plotTitle: string;
  location: string;
  objective: string;
  opening: string;
  openingMeta: string;
  boundary: string;
  videoDescription: string;
  videoPoster: string;
  videoSource: string;
  videoTitle: string;
};

type CastMember = {
  detail: string;
  id: CharacterAssetId;
  imageSrc: string;
  name: string;
  role: string;
  summary: string;
};

type FreeInputResult = {
  response: string;
  clueIds: string[];
  riskDelta: number;
  judgement: string;
  endingId?: EndingId;
  nextPlotId?: PlotId;
  nextState: TurnNextState;
  speakerId?: CharacterAssetId;
  suggestedActions?: string[];
};

type NarrativeRuntimeAction = "freeInput" | "choice" | "continue";

type NarrativeRuntimeTurnResponse = {
  response?: string;
  judgement?: string;
  clueIds?: string[];
  endingId?: string | null;
  nextPlotId?: string | null;
  nextState?: string;
  riskDelta?: number;
  speakerId?: CharacterAssetId | null;
  suggestedActions?: string[];
};

type EndingDefinition = {
  body: string;
  id: EndingId;
  label: string;
  review: string;
  title: string;
};

const CHARACTER_ASSETS = [
  {
    id: "linFeng",
    imageSrc: "/narrative-demo/characters/lin-feng.png",
  },
  {
    id: "brother",
    imageSrc: "/narrative-demo/characters/brother.png",
  },
  {
    id: "receptionTeacher",
    imageSrc: "/narrative-demo/characters/reception-teacher.png",
  },
  {
    id: "securityGuard",
    imageSrc: "/narrative-demo/characters/security-guard.png",
  },
] satisfies Array<{ id: CharacterAssetId; imageSrc: string }>;

const PLOT_VIDEO_ASSETS = {
  plotA: {
    poster: "/narrative-demo/videos/plot-a-enter-elite-school.jpg",
    source: "/narrative-demo/videos/plot-a-enter-elite-school.mp4",
  },
  plotB: {
    poster: "/narrative-demo/videos/plot-b-first-drowning-hearsay.jpg",
    source: "/narrative-demo/videos/plot-b-first-drowning-hearsay.mp4",
  },
} satisfies Record<PlotId, { poster: string; source: string }>;

const SOUND_EFFECTS = [
  {
    id: "doorHardShut",
    source: "/narrative-demo/audio/door-hard-shut.mp3",
    trigger:
      /(关上(?:了)?门|關上(?:了)?門|关门|關門|门在.*关上|門在.*關上|合上(?:了)?登[记記][册冊]|门禁|門禁|door (?:shuts?|closes?)|closes? (?:the )?(?:door|gate|registry))/i,
    volume: 0.55,
  },
] satisfies SoundEffect[];

const MIN_TOTAL_TURNS_BEFORE_PLOT_B = 2;
const MIN_TOTAL_TURNS_BEFORE_ENDING = 6;

const SETUP_STEPS: SetupStep[] = [
  {
    key: "name",
    labelKey: "setup.nameLabel",
    placeholderKey: "setup.namePlaceholder",
  },
  {
    key: "identity",
    labelKey: "setup.identityLabel",
    placeholderKey: "setup.identityPlaceholder",
  },
  {
    key: "details",
    labelKey: "setup.detailsLabel",
    placeholderKey: "setup.detailsPlaceholder",
    optional: true,
  },
];

function splitLabel(label: string) {
  return label.split(" ").filter(Boolean);
}

function createMessage(
  kind: MessageKind,
  body: string,
  meta?: string,
  options?: Pick<StoryEntry, "clueIds" | "media" | "speakerId">
): StoryEntry {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    body,
    meta,
    ...options,
  };
}

function createStoryMedia(story: RuntimeStory): StoryMedia {
  return {
    description: story.videoDescription,
    kind: "video",
    poster: story.videoPoster,
    source: story.videoSource,
    title: story.videoTitle,
  };
}

function resolveSpeakerForClues(clueIds: string[]): CharacterAssetId | undefined {
  if (clueIds.includes("brother_read")) return "brother";
  if (clueIds.includes("guard_name")) return "securityGuard";
  if (clueIds.includes("transfer_date")) return "receptionTeacher";
  return undefined;
}

function getNewClueIds(clueIds: string[], unlockedClueIds: string[]) {
  const unlocked = new Set(unlockedClueIds);
  return Array.from(new Set(clueIds.filter((id) => !unlocked.has(id))));
}

function inferClueIdsFromTurn(
  plotId: PlotId,
  action: NarrativeRuntimeAction,
  playerText: string,
  response: string
) {
  const text = `${playerText}\n${response}`.toLowerCase();
  const clueIds: string[] = [];

  if (
    /(保安|校门|校門|门口|門口|登记|登記|登记册|登記冊|校徽|电子屏|電子屏|security|guard|gate|registry|badge|aw-073)/i.test(
      text
    )
  ) {
    clueIds.push("guard_name");
  }

  if (
    /(通知书|通知書|落款|日期|报到|報到|公章|签署|簽署|文件|转学|轉學|notice|document|transfer|date|signature)/i.test(
      text
    )
  ) {
    clueIds.push("transfer_date");
  }

  if (
    /(哥哥|短信|讯息|訊息|消息|电话|電話|已读|已讀|监护人|監護人|紧急联系人|緊急聯絡人|brother|message|read|guardian)/i.test(
      text
    )
  ) {
    clueIds.push("brother_read");
  }

  if (
    plotId === "plotB" &&
    /(事故简报|事故簡報|简报|簡報|无挣扎|無掙扎|指甲缝|指甲縫|泥沙|自杀结论|自殺結論|溺亡|水域|警戒线|警戒線|case report|suicide|drowning)/i.test(
      text
    )
  ) {
    clueIds.push("case_report_no_struggle");
  }

  if (action === "continue" && clueIds.length > 1) {
    return clueIds.slice(0, 1);
  }

  return Array.from(new Set(clueIds));
}

function shouldEnterPlotB(plotId: PlotId, unlockedClueIds: string[], nextTurnCount: number) {
  if (plotId !== "plotA") return false;
  if (nextTurnCount < MIN_TOTAL_TURNS_BEFORE_PLOT_B) return false;

  const unlocked = new Set(unlockedClueIds);
  return (
    (unlocked.has("guard_name") && unlocked.has("transfer_date")) ||
    (unlocked.has("guard_name") && unlocked.has("brother_read"))
  );
}

function detectSoundEffects(text: string): SoundEffectId[] {
  return SOUND_EFFECTS.filter((effect) => effect.trigger.test(text)).map((effect) => effect.id);
}

export function NarrativeDemoPlayer() {
  const t = useTranslations("narrativeDemo");
  const pathname = usePathname();
  const [mode, setMode] = useState<"setup" | "play">("play");
  const [stepIndex, setStepIndex] = useState(0);
  const [setup, setSetup] = useState<Record<SetupKey, string>>({
    name: "",
    identity: "",
    details: "",
  });
  const [story, setStory] = useState<StoryEntry[]>(() => [
    {
      id: "opening",
      kind: "narrator",
      meta: t("runtime.story.openingMeta"),
      body: t("runtime.story.opening"),
      media: {
        description: t("runtime.story.plotAVideoDescription"),
        kind: "video",
        poster: PLOT_VIDEO_ASSETS.plotA.poster,
        source: PLOT_VIDEO_ASSETS.plotA.source,
        title: t("runtime.story.plotAVideoTitle"),
      },
    },
  ]);
  const [unlockedClueIds, setUnlockedClueIds] = useState<string[]>([]);
  const [currentPlotId, setCurrentPlotId] = useState<PlotId>("plotA");
  const [endingId, setEndingId] = useState<EndingId | null>(null);
  const [draft, setDraft] = useState("");
  const [risk, setRisk] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const soundEffectRefs = useRef<Partial<Record<SoundEffectId, HTMLAudioElement>>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const currentStep = SETUP_STEPS[stepIndex];
  const characterName = setup.name.trim() || t("play.fallbackName");
  const canAdvance = currentStep.optional || setup[currentStep.key].trim().length > 0;
  const turnCount = story.filter((entry) => entry.kind === "player").length;

  const runtimeStories = useMemo<Record<PlotId, RuntimeStory>>(
    () => ({
      plotA: {
        id: "plotA",
        title: t("runtime.story.title"),
        nodeLabel: t("runtime.story.plotANodeLabel"),
        plotTitle: t("runtime.story.plotTitle"),
        location: t("runtime.story.location"),
        objective: t("runtime.story.objective"),
        openingMeta: t("runtime.story.openingMeta"),
        opening: t("runtime.story.opening"),
        boundary: t("runtime.story.boundary"),
        videoDescription: t("runtime.story.plotAVideoDescription"),
        videoPoster: PLOT_VIDEO_ASSETS.plotA.poster,
        videoSource: PLOT_VIDEO_ASSETS.plotA.source,
        videoTitle: t("runtime.story.plotAVideoTitle"),
      },
      plotB: {
        id: "plotB",
        title: t("runtime.story.title"),
        nodeLabel: t("runtime.story.plotBNodeLabel"),
        plotTitle: t("runtime.story.plotBTitle"),
        location: t("runtime.story.plotBLocation"),
        objective: t("runtime.story.plotBObjective"),
        openingMeta: t("runtime.story.plotBOpeningMeta"),
        opening: t("runtime.story.plotBOpening"),
        boundary: t("runtime.story.plotBBoundary"),
        videoDescription: t("runtime.story.plotBVideoDescription"),
        videoPoster: PLOT_VIDEO_ASSETS.plotB.poster,
        videoSource: PLOT_VIDEO_ASSETS.plotB.source,
        videoTitle: t("runtime.story.plotBVideoTitle"),
      },
    }),
    [t]
  );
  const runtimeStory = runtimeStories[currentPlotId];

  const endings = useMemo<Record<EndingId, EndingDefinition>>(
    () => ({
      truth: {
        body: t("runtime.endings.truth.body"),
        id: "truth",
        label: t("runtime.endings.truth.label"),
        review: t("runtime.endings.truth.review"),
        title: t("runtime.endings.truth.title"),
      },
      intervention: {
        body: t("runtime.endings.intervention.body"),
        id: "intervention",
        label: t("runtime.endings.intervention.label"),
        review: t("runtime.endings.intervention.review"),
        title: t("runtime.endings.intervention.title"),
      },
      coverup: {
        body: t("runtime.endings.coverup.body"),
        id: "coverup",
        label: t("runtime.endings.coverup.label"),
        review: t("runtime.endings.coverup.review"),
        title: t("runtime.endings.coverup.title"),
      },
    }),
    [t]
  );
  const currentEnding = endingId ? endings[endingId] : null;

  const clues = useMemo<Record<string, Clue>>(
    () => ({
      transfer_date: {
        id: "transfer_date",
        title: t("runtime.clues.transferDate.title"),
        type: t("runtime.clues.transferDate.type"),
        summary: t("runtime.clues.transferDate.summary"),
      },
      brother_read: {
        id: "brother_read",
        title: t("runtime.clues.brotherRead.title"),
        type: t("runtime.clues.brotherRead.type"),
        summary: t("runtime.clues.brotherRead.summary"),
      },
      guard_name: {
        id: "guard_name",
        title: t("runtime.clues.guardName.title"),
        type: t("runtime.clues.guardName.type"),
        summary: t("runtime.clues.guardName.summary"),
      },
      case_report_no_struggle: {
        id: "case_report_no_struggle",
        title: t("runtime.clues.caseReportNoStruggle.title"),
        type: t("runtime.clues.caseReportNoStruggle.type"),
        summary: t("runtime.clues.caseReportNoStruggle.summary"),
      },
    }),
    [t]
  );

  const freeInputResults = useMemo(
    () => ({
      guard: {
        clueIds: ["guard_name"],
        nextState: "stay" as const,
        riskDelta: 0,
        judgement: t("runtime.freeInput.guard.judgement"),
        response: t("runtime.freeInput.guard.response"),
      },
      brother: {
        clueIds: ["brother_read"],
        nextState: "stay" as const,
        riskDelta: 1,
        judgement: t("runtime.freeInput.brother.judgement"),
        response: t("runtime.freeInput.brother.response"),
      },
      transfer: {
        clueIds: ["transfer_date"],
        nextState: "stay" as const,
        riskDelta: 1,
        judgement: t("runtime.freeInput.transfer.judgement"),
        response: t("runtime.freeInput.transfer.response"),
      },
      offTopic: {
        clueIds: [],
        nextState: "stay" as const,
        riskDelta: 0,
        judgement: t("runtime.freeInput.offTopic.judgement"),
        response: t("runtime.freeInput.offTopic.response"),
      },
    }),
    [t]
  );

  const continuations = useMemo(
    () => [
      t("runtime.continuations.first"),
      t("runtime.continuations.second"),
      t("runtime.continuations.third"),
    ],
    [t]
  );

  const unlockedClues = useMemo(
    () => unlockedClueIds.map((id) => clues[id]).filter(Boolean),
    [clues, unlockedClueIds]
  );

  const cast = useMemo(
    () =>
      CHARACTER_ASSETS.map((character) => {
        const isPlayer = character.id === "linFeng";

        return {
          ...character,
          detail: isPlayer
            ? setup.details || t(`runtime.characters.${character.id}.detail`)
            : t(`runtime.characters.${character.id}.detail`),
          name: isPlayer ? characterName : t(`runtime.characters.${character.id}.name`),
          role: t(`runtime.characters.${character.id}.role`),
          summary: isPlayer
            ? setup.identity || t(`runtime.characters.${character.id}.summary`)
            : t(`runtime.characters.${character.id}.summary`),
        };
      }),
    [characterName, setup.details, setup.identity, t]
  );

  useEffect(() => {
    const routeLocale = pathname?.match(/^\/(en-US|zh-CN|zh-HK)(?:\/|$)/)?.[1] ?? "zh-CN";
    setLanguage(routeLocale);
  }, [pathname]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [isThinking, story]);

  useEffect(() => {
    if (isComposerOpen) {
      composerRef.current?.focus();
    }
  }, [isComposerOpen]);

  function updateSetup(value: string) {
    setSetup((current) => ({ ...current, [currentStep.key]: value }));
  }

  function initialStoryEntry(): StoryEntry {
    const plotA = runtimeStories.plotA;

    return {
      id: "opening",
      kind: "narrator",
      meta: plotA.openingMeta,
      body: plotA.opening,
      media: createStoryMedia(plotA),
    };
  }

  function goNext() {
    if (!canAdvance) return;

    if (stepIndex < SETUP_STEPS.length - 1) {
      setStepIndex((index) => index + 1);
      return;
    }

    setStory([initialStoryEntry()]);
    setUnlockedClueIds([]);
    setCurrentPlotId("plotA");
    setEndingId(null);
    setRisk(0);
    setSuggestedActions([]);
    setMode("play");
  }

  function goBack() {
    if (stepIndex > 0) {
      setStepIndex((index) => index - 1);
    }
  }

  function restartGame() {
    setStory([initialStoryEntry()]);
    setUnlockedClueIds([]);
    setCurrentPlotId("plotA");
    setEndingId(null);
    setRisk(0);
    setDraft("");
    setSuggestedActions([]);
    setIsComposerOpen(false);
    setIsThinking(false);
    setMode("play");
  }

  function classifyFreeInput(input: string): FreeInputResult {
    const normalized = input.toLowerCase();

    if (/(保安|校门|觀察|观察|登记|登記|门口|門口|security|guard|gate|observe)/.test(normalized)) {
      return freeInputResults.guard;
    }

    if (/(哥哥|短信|電話|电话|联系|聯絡|已读|已讀|brother|message|call|text)/.test(normalized)) {
      return freeInputResults.brother;
    }

    if (
      /(通知书|通知書|日期|转学|轉學|文件|纸|紙|notice|document|transfer|date)/.test(normalized)
    ) {
      return freeInputResults.transfer;
    }

    return freeInputResults.offTopic;
  }

  function inferEndingId(nextUnlockedClueIds: string[], nextRisk: number): EndingId {
    if (nextRisk >= 5) return "intervention";
    if (
      nextUnlockedClueIds.includes("case_report_no_struggle") &&
      nextUnlockedClueIds.length >= 3
    ) {
      return "truth";
    }
    return "coverup";
  }

  function resolveTurnOutcome(
    result: FreeInputResult,
    nextUnlockedClueIds: string[],
    nextRisk: number,
    nextTurnCount: number
  ):
    | { nextState: "stay" }
    | { nextState: "advancePlot"; nextPlotId: PlotId }
    | { endingId: EndingId; nextState: "ending" } {
    if (currentPlotId === "plotA") {
      if (
        nextTurnCount >= MIN_TOTAL_TURNS_BEFORE_PLOT_B &&
        result.nextState === "advancePlot" &&
        result.nextPlotId === "plotB"
      ) {
        return { nextPlotId: "plotB", nextState: "advancePlot" };
      }

      if (shouldEnterPlotB(currentPlotId, nextUnlockedClueIds, nextTurnCount)) {
        return { nextPlotId: "plotB", nextState: "advancePlot" };
      }

      return { nextState: "stay" };
    }

    if (currentPlotId === "plotB") {
      if (nextTurnCount < MIN_TOTAL_TURNS_BEFORE_ENDING) {
        return { nextState: "stay" };
      }

      if (result.nextState === "ending") {
        return {
          endingId: result.endingId ?? inferEndingId(nextUnlockedClueIds, nextRisk),
          nextState: "ending",
        };
      }

      if (nextRisk >= 5) return { endingId: "intervention", nextState: "ending" };

      if (
        nextUnlockedClueIds.includes("case_report_no_struggle") &&
        nextUnlockedClueIds.length >= 3
      ) {
        return { endingId: "truth", nextState: "ending" };
      }

      if (nextTurnCount >= 10 && !nextUnlockedClueIds.includes("case_report_no_struggle")) {
        return { endingId: "coverup", nextState: "ending" };
      }
    }

    return { nextState: "stay" };
  }

  function runtimeEndpoint() {
    const locale = pathname?.match(/^\/(en-US|zh-CN|zh-HK)(?:\/|$)/)?.[1] ?? "zh-CN";
    return `/${locale}/narrative-runtime/turn`;
  }

  async function requestRuntimeTurn(
    action: NarrativeRuntimeAction,
    playerText: string
  ): Promise<FreeInputResult> {
    const response = await fetch(runtimeEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        locale: "zh-CN",
        playerText,
        setup,
        story: story.map((entry) => ({
          kind: entry.kind,
          body: entry.body,
          meta: entry.meta,
          clueIds: entry.clueIds ?? [],
        })),
        unlockedClueIds,
        currentPlot: {
          id: runtimeStory.id,
          title: runtimeStory.plotTitle,
          location: runtimeStory.location,
          objective: runtimeStory.objective,
          boundary: runtimeStory.boundary,
        },
        currentSuggestedActions: suggestedActions,
        risk,
        turnCount,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as
      | NarrativeRuntimeTurnResponse
      | { error?: string; detail?: string };

    if (!response.ok || ("error" in payload && payload.error)) {
      const message =
        "error" in payload && payload.error
          ? payload.detail
            ? `${payload.error} ${payload.detail}`
            : payload.error
          : `HTTP ${response.status}`;
      throw new Error(message);
    }

    const turnPayload = payload as NarrativeRuntimeTurnResponse;
    const clueIds = Array.isArray(turnPayload.clueIds)
      ? turnPayload.clueIds.filter(
          (id: unknown): id is string => typeof id === "string" && Boolean(clues[id])
        )
      : [];

    return {
      response:
        typeof turnPayload.response === "string" && turnPayload.response.trim()
          ? turnPayload.response.trim()
          : t("runtime.freeInput.offTopic.response"),
      clueIds,
      riskDelta:
        typeof turnPayload.riskDelta === "number" && Number.isFinite(turnPayload.riskDelta)
          ? Math.max(0, Math.min(3, Math.round(turnPayload.riskDelta)))
          : 0,
      judgement:
        typeof turnPayload.judgement === "string" && turnPayload.judgement.trim()
          ? turnPayload.judgement.trim()
          : t("runtime.freeInput.offTopic.judgement"),
      endingId:
        turnPayload.endingId === "truth" ||
        turnPayload.endingId === "intervention" ||
        turnPayload.endingId === "coverup"
          ? turnPayload.endingId
          : undefined,
      nextPlotId:
        turnPayload.nextPlotId === "plotA" || turnPayload.nextPlotId === "plotB"
          ? turnPayload.nextPlotId
          : undefined,
      nextState:
        turnPayload.nextState === "advancePlot" || turnPayload.nextState === "ending"
          ? turnPayload.nextState
          : "stay",
      speakerId:
        turnPayload.speakerId &&
        CHARACTER_ASSETS.some((asset) => asset.id === turnPayload.speakerId)
          ? turnPayload.speakerId
          : undefined,
      suggestedActions: Array.isArray(turnPayload.suggestedActions)
        ? Array.from(
            new Set(
              turnPayload.suggestedActions
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean)
                .map((item) => item.slice(0, 28))
            )
          ).slice(0, 3)
        : [],
    };
  }

  async function applyTurn({
    action,
    fallback,
    playerText,
  }: {
    action: Exclude<NarrativeRuntimeAction, "continue">;
    fallback: FreeInputResult;
    playerText: string;
  }) {
    if (isThinking || endingId) return;

    const trimmedText = playerText.trim();
    if (!trimmedText) return;

    setStory((entries) => [
      ...entries,
      createMessage("player", trimmedText, undefined, { speakerId: "linFeng" }),
    ]);
    setSuggestedActions([]);
    setDraft("");
    setIsComposerOpen(false);
    setIsThinking(true);

    let result = fallback;
    let usedRuntime = false;

    try {
      result = await requestRuntimeTurn(action, trimmedText);
      usedRuntime = true;
    } catch (error) {
      void error;
    }

    playSoundEffectsForText(result.response);
    const inferredClueIds = inferClueIdsFromTurn(
      currentPlotId,
      action,
      trimmedText,
      result.response
    );
    const mergedClueIds = Array.from(new Set([...result.clueIds, ...inferredClueIds]));
    const newClueIds = getNewClueIds(mergedClueIds, unlockedClueIds);
    const nextUnlockedClueIds = Array.from(new Set([...unlockedClueIds, ...newClueIds]));
    const nextRisk = Math.min(9, risk + result.riskDelta);
    const outcome = resolveTurnOutcome(result, nextUnlockedClueIds, nextRisk, turnCount + 1);
    const shouldTransition = outcome.nextState === "advancePlot";
    const transitionStory = shouldTransition ? runtimeStories[outcome.nextPlotId] : null;

    setSuggestedActions(outcome.nextState === "stay" ? (result.suggestedActions ?? []) : []);
    setUnlockedClueIds(nextUnlockedClueIds);
    if (shouldTransition) {
      setCurrentPlotId(outcome.nextPlotId);
    }
    if (outcome.nextState === "ending") {
      setEndingId(outcome.endingId);
      setIsComposerOpen(false);
    }
    setRisk(nextRisk);
    setStory((entries) => [
      ...entries,
      createMessage(
        "narrator",
        result.response,
        newClueIds.length > 0
          ? t("play.clueUnlocked", { count: newClueIds.length })
          : usedRuntime
            ? t("play.intentHandledByLLM", { judgement: result.judgement })
            : t("play.intentHandledFallback", { judgement: result.judgement }),
        {
          clueIds: newClueIds,
          speakerId: result.speakerId ?? resolveSpeakerForClues(newClueIds),
        }
      ),
      ...(transitionStory
        ? [
            createMessage("narrator", transitionStory.opening, transitionStory.openingMeta, {
              media: createStoryMedia(transitionStory),
              speakerId: "receptionTeacher",
            }),
          ]
        : []),
    ]);
    setIsThinking(false);
  }

  function submitSuggestedAction(label: string) {
    primeSoundEffects();
    void applyTurn({
      action: "choice",
      fallback: classifyFreeInput(label),
      playerText: label,
    });
  }

  function submitFreeInput() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    primeSoundEffects();
    void applyTurn({
      action: "freeInput",
      fallback: classifyFreeInput(trimmed),
      playerText: trimmed,
    });
  }

  async function continueStory() {
    if (isThinking || endingId) return;

    primeSoundEffects();
    setSuggestedActions([]);
    setIsThinking(true);

    let result: FreeInputResult = {
      response: continuations[turnCount % continuations.length],
      clueIds: [],
      nextState: "stay",
      riskDelta: 0,
      judgement: t("play.continue"),
    };
    let usedRuntime = false;

    try {
      result = await requestRuntimeTurn("continue", "");
      usedRuntime = true;
    } catch (error) {
      void error;
    }

    playSoundEffectsForText(result.response);
    const inferredClueIds = inferClueIdsFromTurn(currentPlotId, "continue", "", result.response);
    const mergedClueIds = Array.from(new Set([...result.clueIds, ...inferredClueIds]));
    const newClueIds = getNewClueIds(mergedClueIds, unlockedClueIds);
    const nextUnlockedClueIds = Array.from(new Set([...unlockedClueIds, ...newClueIds]));
    const nextRisk = Math.min(9, risk + result.riskDelta);
    const outcome = resolveTurnOutcome(result, nextUnlockedClueIds, nextRisk, turnCount + 1);
    const shouldTransition = outcome.nextState === "advancePlot";
    const transitionStory = shouldTransition ? runtimeStories[outcome.nextPlotId] : null;

    setSuggestedActions(outcome.nextState === "stay" ? (result.suggestedActions ?? []) : []);
    setUnlockedClueIds(nextUnlockedClueIds);
    if (shouldTransition) {
      setCurrentPlotId(outcome.nextPlotId);
    }
    if (outcome.nextState === "ending") {
      setEndingId(outcome.endingId);
      setIsComposerOpen(false);
    }
    setRisk(nextRisk);
    setStory((entries) => [
      ...entries,
      createMessage(
        "narrator",
        result.response,
        usedRuntime ? t("play.systemContinueLLM") : t("play.systemContinue"),
        {
          clueIds: newClueIds,
          speakerId: result.speakerId ?? resolveSpeakerForClues(newClueIds),
        }
      ),
      ...(transitionStory
        ? [
            createMessage("narrator", transitionStory.opening, transitionStory.openingMeta, {
              media: createStoryMedia(transitionStory),
              speakerId: "receptionTeacher",
            }),
          ]
        : []),
    ]);
    setIsThinking(false);
  }

  function primeSoundEffects() {
    for (const effect of SOUND_EFFECTS) {
      const audio = soundEffectRefs.current[effect.id];
      if (!audio || audio.dataset.narrativeSfxPrimed === "true") continue;

      try {
        audio.muted = true;
        audio.currentTime = 0;
        void audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            audio.dataset.narrativeSfxPrimed = "true";
          })
          .catch(() => {
            audio.muted = false;
          });
      } catch {
        audio.muted = false;
      }
    }
  }

  function playSoundEffectsForText(text: string) {
    for (const effectId of detectSoundEffects(text)) {
      const effect = SOUND_EFFECTS.find((item) => item.id === effectId);
      const audio = soundEffectRefs.current[effectId];
      if (!effect || !audio) continue;

      try {
        audio.currentTime = 0;
        audio.volume = effect.volume;
        audio.dataset.narrativeSfxStatus = "pending";
        void audio
          .play()
          .then(() => {
            audio.dataset.narrativeSfxStatus = "playing";
          })
          .catch(() => {
            audio.dataset.narrativeSfxStatus = "blocked";
            // Sound effects should never block the text-game turn loop.
          });
      } catch {
        audio.dataset.narrativeSfxStatus = "error";
        // Some browsers reject currentTime changes until metadata is ready.
      }
    }
  }

  return (
    <main
      className="relative h-screen overflow-hidden bg-[#050505] text-white"
      style={{
        fontFamily:
          '"Google Sans Flex", "MiSansVF", "MiSans VF", Inter, "Noto Sans SC", system-ui, sans-serif',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:28px_28px] opacity-25"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_18%,transparent_74%,rgba(255,255,255,0.025))]"
      />

      {mode === "setup" ? (
        <section className="relative z-10 grid min-h-screen place-items-center px-5 py-20">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="grid w-full max-w-4xl justify-items-center gap-10 text-center"
            >
              <div className="space-y-5">
                <div className="flex flex-wrap justify-center gap-x-2 gap-y-1">
                  {splitLabel(t(currentStep.labelKey)).map((word, index) => (
                    <motion.span
                      key={`${currentStep.key}-${word}-${index}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: index * 0.035 }}
                      className="text-[20px] leading-tight font-semibold text-white sm:text-[22px]"
                    >
                      {word}
                    </motion.span>
                  ))}
                </div>
                <input
                  autoFocus
                  aria-label={t(currentStep.labelKey)}
                  value={setup[currentStep.key]}
                  onChange={(event) => updateSetup(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") goNext();
                  }}
                  placeholder={t(currentStep.placeholderKey)}
                  className="h-20 w-full border-0 bg-transparent px-2 text-center text-[38px] leading-none font-semibold text-white/88 caret-primary outline-none placeholder:text-white/26 sm:text-[52px]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {stepIndex > 0 ? (
                  <WizardButton onClick={goBack} icon={<IconArrowLeft />} label={t("setup.back")} />
                ) : null}
                <WizardButton
                  onClick={goNext}
                  disabled={!canAdvance}
                  icon={
                    stepIndex === SETUP_STEPS.length - 1 ? <IconPlayerPlay /> : <IconArrowRight />
                  }
                  iconPosition={stepIndex === SETUP_STEPS.length - 1 ? "start" : "end"}
                  label={stepIndex === SETUP_STEPS.length - 1 ? t("setup.start") : t("setup.next")}
                  primary={stepIndex === SETUP_STEPS.length - 1}
                />
              </div>
            </motion.div>
          </AnimatePresence>
        </section>
      ) : (
        <section className="relative z-10 flex h-screen flex-col overflow-hidden px-5 pb-5 pt-8">
          <div
            ref={feedRef}
            className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-2 pb-44 pt-6"
          >
            <article className="mx-auto max-w-[820px]">
              <StoryContextLine
                clueCount={unlockedClues.length}
                location={runtimeStory.location}
                nodeLabel={runtimeStory.nodeLabel}
                objective={runtimeStory.objective}
                plotTitle={runtimeStory.plotTitle}
                t={t}
              />
              <SceneAssetPrelude cast={cast} t={t} />

              <AnimatePresence initial={false}>
                {story.map((entry) => (
                  <TextStoryEntry key={entry.id} cast={cast} clues={clues} entry={entry} t={t} />
                ))}
              </AnimatePresence>

              {isThinking ? <ThinkingRow label={t("play.aiThinking")} /> : null}
              {currentEnding ? (
                <EndingCard
                  clueCount={unlockedClues.length}
                  ending={currentEnding}
                  onRestart={restartGame}
                  risk={risk}
                  turnCount={turnCount}
                  t={t}
                />
              ) : null}
            </article>
          </div>

          {currentEnding ? null : (
            <TurnDock
              composerRef={composerRef}
              draft={draft}
              isComposerOpen={isComposerOpen}
              isThinking={isThinking}
              onContinue={continueStory}
              onDraftChange={setDraft}
              onPrimeSoundEffects={primeSoundEffects}
              onSuggestedAction={submitSuggestedAction}
              onSubmit={submitFreeInput}
              onToggleComposer={() => setIsComposerOpen((current) => !current)}
              suggestedActions={suggestedActions}
              t={t}
            />
          )}
        </section>
      )}
      {SOUND_EFFECTS.map((effect) => (
        <audio
          key={effect.id}
          aria-hidden
          data-narrative-sfx={effect.id}
          preload="auto"
          ref={(node) => {
            if (node) {
              soundEffectRefs.current[effect.id] = node;
            } else {
              delete soundEffectRefs.current[effect.id];
            }
          }}
          src={effect.source}
        />
      ))}
    </main>
  );
}

function StoryContextLine({
  clueCount,
  location,
  nodeLabel,
  objective,
  plotTitle,
  t,
}: {
  clueCount: number;
  location: string;
  nodeLabel: string;
  objective: string;
  plotTitle: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <header className="mb-12 border-b border-white/10 pb-8">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-bold text-white/44">
        <span className="inline-flex items-center gap-1.5">
          <IconFlag className="size-4" />
          {nodeLabel}
        </span>
        <span className="text-white/20">/</span>
        <span className="inline-flex items-center gap-1.5">
          <IconMapPin className="size-4" />
          {location}
        </span>
        <span className="text-white/20">/</span>
        <span className="inline-flex items-center gap-1.5">
          <IconFingerprint className="size-4" />
          {t("play.cluesLabel", { count: clueCount })}
        </span>
      </div>
      <h2 className="text-3xl font-black leading-tight text-white sm:text-5xl">{plotTitle}</h2>
      <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-white/46">{objective}</p>
    </header>
  );
}

function SceneAssetPrelude({
  cast,
  t,
}: {
  cast: CastMember[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="mb-12">
      <div className="rounded-[26px] border border-white/8 bg-white/[0.035] p-3">
        <div className="mb-3 flex items-center gap-2 px-1 text-xs font-black uppercase tracking-[0.14em] text-white/35">
          <IconUsersGroup className="size-4" />
          {t("play.characterPanel")}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {cast.map((member) => (
            <div
              key={member.id}
              className="flex min-w-[180px] items-center gap-3 rounded-[18px] bg-black/30 p-2"
            >
              <div className="relative aspect-[9/16] w-10 shrink-0 overflow-hidden rounded-[12px] bg-black/50">
                <Image
                  src={member.imageSrc}
                  alt={member.name}
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">{member.name}</div>
                <div className="truncate text-xs font-bold text-white/38">{member.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TextStoryEntry({
  cast,
  clues,
  entry,
  t,
}: {
  cast: CastMember[];
  clues: Record<string, Clue>;
  entry: StoryEntry;
  t: ReturnType<typeof useTranslations>;
}) {
  const isPlayer = entry.kind === "player";
  const speaker = entry.speakerId
    ? cast.find((member) => member.id === entry.speakerId)
    : undefined;
  const revealedClues =
    entry.clueIds?.map((id) => clues[id]).filter((clue): clue is Clue => Boolean(clue)) ?? [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="mb-9"
    >
      {entry.meta ? (
        <div className="mb-3 text-sm font-black uppercase tracking-[0.08em] text-white/34">
          {entry.meta}
        </div>
      ) : null}
      {entry.media ? <InlineMediaCue media={entry.media} /> : null}
      {speaker ? (
        <div className="mb-3 flex items-center gap-3 text-sm font-black text-white/46">
          <div className="relative aspect-[9/16] w-8 overflow-hidden rounded-[10px] bg-black/45">
            <Image
              src={speaker.imageSrc}
              alt={speaker.name}
              fill
              sizes="32px"
              className="object-cover"
            />
          </div>
          <span>{isPlayer ? speaker.name : `${t("play.character")} · ${speaker.name}`}</span>
        </div>
      ) : null}
      {entry.body ? (
        <p
          className={cn(
            "text-[21px] font-semibold leading-[2.05] text-white/88 sm:text-[24px]",
            isPlayer && "text-white/58"
          )}
          style={{
            fontFamily:
              '"Iowan Old Style", "Noto Serif SC", ui-serif, Georgia, Cambria, "Times New Roman", serif',
          }}
        >
          {entry.body}
        </p>
      ) : null}
      {revealedClues.length > 0 ? <InlineClueCards clues={revealedClues} t={t} /> : null}
    </motion.div>
  );
}

function InlineMediaCue({ media }: { media: StoryMedia }) {
  return (
    <article className="mb-6 overflow-hidden rounded-[30px] border border-white/10 bg-black shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
      <div className="relative aspect-video min-h-[220px] overflow-hidden bg-black">
        <video
          autoPlay
          controls
          data-narrative-media-video
          loop
          muted
          playsInline
          preload="metadata"
          poster={media.poster}
          className="absolute inset-0 size-full object-cover"
        >
          <source src={media.source} type="video/mp4" />
        </video>
      </div>
    </article>
  );
}

function EndingCard({
  clueCount,
  ending,
  onRestart,
  risk,
  t,
  turnCount,
}: {
  clueCount: number;
  ending: EndingDefinition;
  onRestart: () => void;
  risk: number;
  t: ReturnType<typeof useTranslations>;
  turnCount: number;
}) {
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="mb-16 mt-6 overflow-hidden rounded-[34px] border border-white/12 bg-white/[0.075] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-8"
    >
      <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-black text-white/48">
            <IconFlag className="size-4" />
            {t("play.endingReached")}
            <span className="text-white/24">/</span>
            {ending.label}
          </div>
          <h2 className="text-[34px] font-black leading-tight text-white sm:text-[44px]">
            {ending.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex shrink-0 transform-gpu items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black shadow-[0_7px_0_0_rgba(255,255,255,0.2),0_18px_45px_rgba(255,255,255,0.14)] transition-[transform,box-shadow] duration-150 active:translate-y-1 active:shadow-[0_2px_0_0_rgba(255,255,255,0.18),0_10px_30px_rgba(255,255,255,0.1)]"
        >
          <IconPlayerPlay className="size-5" />
          {t("play.restart")}
        </button>
      </div>

      <p className="mb-6 text-[21px] font-semibold leading-[1.9] text-white/72">{ending.body}</p>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <EndingMetric label={t("play.turnMetric")} value={String(turnCount)} />
        <EndingMetric label={t("play.riskMetric")} value={String(risk)} />
        <EndingMetric label={t("play.clueMetric")} value={String(clueCount)} />
      </div>

      <div className="rounded-[24px] bg-black/28 p-5 text-base font-semibold leading-8 text-white/58">
        <div className="mb-2 flex items-center gap-2 text-sm font-black text-white/34">
          <IconFingerprint className="size-4" />
          {t("play.endingReview")}
        </div>
        {ending.review}
      </div>
    </motion.section>
  );
}

function EndingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] bg-black/24 px-5 py-4">
      <div className="text-3xl font-black text-white">{value}</div>
      <div className="mt-1 text-sm font-black text-white/36">{label}</div>
    </div>
  );
}

function InlineClueCards({ clues, t }: { clues: Clue[]; t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="mt-6 space-y-3">
      <div className="inline-flex items-center gap-2 rounded-full bg-[#1a2435] px-3 py-1.5 text-xs font-black text-[#8bbcff]">
        <IconFingerprint className="size-4" />
        {t("play.unlockedClues")}
      </div>
      <div className="grid gap-3">
        {clues.map((clue) => (
          <article
            key={clue.id}
            className="rounded-[24px] border border-[#8bbcff]/18 bg-[#0f1622]/82 p-4 shadow-[0_18px_60px_rgba(40,120,255,0.08)]"
          >
            <div className="mb-2 text-xs font-black text-[#8bbcff]">{clue.type}</div>
            <h4 className="text-base font-black text-white">{clue.title}</h4>
            <p className="mt-2 text-sm font-bold leading-6 text-white/58">{clue.summary}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function ThinkingRow({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-3 rounded-full bg-[#202020] px-4 py-3 text-sm font-bold text-white/55">
        <span className="flex gap-1">
          <span className="size-1.5 animate-pulse rounded-full bg-white/50" />
          <span className="size-1.5 animate-pulse rounded-full bg-white/50 [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-white/50 [animation-delay:240ms]" />
        </span>
        {label}
      </div>
    </div>
  );
}

function TurnDock({
  composerRef,
  draft,
  isComposerOpen,
  isThinking,
  onContinue,
  onDraftChange,
  onPrimeSoundEffects,
  onSuggestedAction,
  onSubmit,
  onToggleComposer,
  suggestedActions,
  t,
}: {
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  isComposerOpen: boolean;
  isThinking: boolean;
  onContinue: () => void;
  onDraftChange: (value: string) => void;
  onPrimeSoundEffects: () => void;
  onSuggestedAction: (label: string) => void;
  onSubmit: () => void;
  onToggleComposer: () => void;
  suggestedActions: string[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-5 pb-6">
      <div className="pointer-events-auto mx-auto max-w-[820px]">
        <AnimatePresence mode="wait" initial={false}>
          {isComposerOpen ? (
            <motion.div
              key="composer"
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.985 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[30px] border border-white/10 bg-[#111]/95 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0 px-1 text-xs font-black text-white/42">
                  {t("play.freeInputLabel")}
                </div>
                <button
                  type="button"
                  aria-label={t("play.closeComposer")}
                  disabled={isThinking}
                  onClick={onToggleComposer}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.08] text-white/58 transition hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-40"
                >
                  <IconX className="size-5" />
                </button>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_54px] gap-2">
                <textarea
                  ref={composerRef}
                  value={draft}
                  disabled={isThinking}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      onSubmit();
                    }
                  }}
                  placeholder={t("play.inputPlaceholder")}
                  className="max-h-40 min-h-24 resize-none rounded-[22px] bg-black/42 px-5 py-4 text-lg font-semibold leading-8 text-white outline-none placeholder:text-white/28 disabled:opacity-45"
                />
                <button
                  type="button"
                  disabled={isThinking || draft.trim().length === 0}
                  onPointerDown={onPrimeSoundEffects}
                  onClick={onSubmit}
                  aria-label={t("play.takeTurn")}
                  className="grid size-[54px] transform-gpu place-items-center rounded-full bg-white text-black shadow-[0_8px_0_0_rgba(255,255,255,0.18),0_16px_45px_rgba(255,255,255,0.14)] transition-[transform,box-shadow,opacity] duration-150 active:translate-y-1 active:shadow-[0_3px_0_0_rgba(255,255,255,0.18),0_10px_32px_rgba(255,255,255,0.12)] disabled:pointer-events-none disabled:opacity-35"
                >
                  <IconSend className="size-5" />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="controls"
              initial={{ opacity: 0, y: 12, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="flex w-full max-w-full flex-wrap items-center justify-start gap-3"
            >
              <ActionButton
                icon={<IconPencil />}
                label={t("play.takeTurnPrompt")}
                onClick={onToggleComposer}
                onPointerDown={onPrimeSoundEffects}
                variant="white"
              />
              <ActionButton
                icon={<IconWand />}
                label={t("play.continue")}
                onClick={onContinue}
                onPointerDown={onPrimeSoundEffects}
                variant="primary"
              />
              {suggestedActions.map((label) => (
                <ActionButton
                  key={label}
                  icon={<IconSparkles />}
                  label={label}
                  onClick={() => onSuggestedAction(label)}
                  onPointerDown={onPrimeSoundEffects}
                  variant="primaryGhost"
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function WizardButton({
  disabled,
  icon,
  iconPosition = "start",
  label,
  onClick,
  primary,
}: {
  disabled?: boolean;
  icon: ReactNode;
  iconPosition?: "start" | "end";
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-12 min-w-[8.5rem] transform-gpu items-center justify-center gap-3 rounded-full border px-6 text-sm font-semibold uppercase transition-[transform,box-shadow,background-color,color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-px active:translate-y-1 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none",
        primary
          ? "border-primary bg-primary text-white shadow-[0_6px_0_0_#8f1216] hover:bg-primary-hover hover:shadow-[0_7px_0_0_#8f1216] active:shadow-[0_2px_0_0_#8f1216]"
          : "border-white/10 bg-white/[0.075] text-white shadow-[0_6px_0_0_rgba(255,255,255,0.1)] hover:bg-white/[0.12] hover:shadow-[0_7px_0_0_rgba(255,255,255,0.1)] active:shadow-[0_2px_0_0_rgba(255,255,255,0.1)]"
      )}
    >
      {iconPosition === "start" ? <span className="[&_svg]:size-4">{icon}</span> : null}
      <span>{label}</span>
      {iconPosition === "end" ? <span className="[&_svg]:size-4">{icon}</span> : null}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  onPointerDown,
  variant = "neutral",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onPointerDown?: () => void;
  variant?: "neutral" | "white" | "primary" | "primaryGhost";
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 transform-gpu items-center justify-center gap-2 rounded-full border px-5 text-sm font-bold transition-[transform,box-shadow,background-color,color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-px active:translate-y-1",
        variant === "white" &&
          "border-white/18 bg-white text-black shadow-[0_5px_0_0_rgba(255,255,255,0.22),0_18px_45px_rgba(0,0,0,0.34)] hover:bg-white/90 hover:shadow-[0_6px_0_0_rgba(255,255,255,0.2),0_20px_50px_rgba(0,0,0,0.36)] active:shadow-[0_1px_0_0_rgba(255,255,255,0.2),0_12px_36px_rgba(0,0,0,0.3)]",
        variant === "primary" &&
          "border-primary bg-primary text-white shadow-[0_5px_0_0_#8f1216,0_18px_45px_rgba(229,34,39,0.18)] hover:bg-primary-hover hover:shadow-[0_6px_0_0_#8f1216,0_20px_50px_rgba(229,34,39,0.22)] active:shadow-[0_1px_0_0_#8f1216,0_12px_36px_rgba(229,34,39,0.14)]",
        variant === "primaryGhost" &&
          "border-primary/35 bg-primary/10 text-primary shadow-[0_5px_0_0_rgba(229,34,39,0.16),0_18px_45px_rgba(0,0,0,0.28)] hover:border-primary/55 hover:bg-primary/15 hover:text-primary-foreground hover:shadow-[0_6px_0_0_rgba(229,34,39,0.18),0_20px_50px_rgba(0,0,0,0.32)] active:shadow-[0_1px_0_0_rgba(229,34,39,0.16),0_12px_36px_rgba(0,0,0,0.24)]",
        variant === "neutral" &&
          "border-white/10 bg-white/[0.055] text-white/72 shadow-[0_5px_0_0_rgba(255,255,255,0.1),0_18px_45px_rgba(0,0,0,0.28)] hover:bg-white/[0.1] hover:text-white hover:shadow-[0_6px_0_0_rgba(255,255,255,0.1),0_20px_50px_rgba(0,0,0,0.32)] active:shadow-[0_1px_0_0_rgba(255,255,255,0.1),0_12px_36px_rgba(0,0,0,0.24)]"
      )}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
