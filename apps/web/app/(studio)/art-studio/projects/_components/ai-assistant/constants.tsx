import {
  IconAd,
  IconBook2,
  IconFileText,
  IconLayoutGrid,
  IconMapPin,
  IconMovie,
  IconPackage,
  IconPencil,
  IconSparkles,
  IconUser,
} from "@tabler/icons-react";

export const AI_AGENTS = [
  {
    key: "general",
    icon: <IconSparkles className="size-4" />,
    nameKey: "generalAgent" as const,
    descKey: "generalAgentDesc" as const,
  },
  {
    key: "script",
    icon: <IconPencil className="size-4" />,
    nameKey: "scriptAgent" as const,
    descKey: "scriptAgentDesc" as const,
  },
] as const;

export type QuickAction = {
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
  promptKey: string;
  colors: string[];
  glowColor: string;
};

export const quickActionsByAgent: Record<string, QuickAction[]> = {
  general: [
    {
      icon: <IconFileText className="size-5" />,
      titleKey: "breakdownScript",
      descKey: "breakdownScriptDesc",
      promptKey: "breakdownScriptPrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "designStoryboard",
      descKey: "designStoryboardDesc",
      promptKey: "designStoryboardPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPackage className="size-5" />,
      titleKey: "assetAnalysis",
      descKey: "assetAnalysisDesc",
      promptKey: "assetAnalysisPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  script: [
    {
      icon: <IconFileText className="size-5" />,
      titleKey: "qaScriptWrite",
      descKey: "qaScriptWriteDesc",
      promptKey: "qaScriptWritePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaScriptAnalyze",
      descKey: "qaScriptAnalyzeDesc",
      promptKey: "qaScriptAnalyzePrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPencil className="size-5" />,
      titleKey: "qaScriptDialogue",
      descKey: "qaScriptDialogueDesc",
      promptKey: "qaScriptDialoguePrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  storyboard: [
    {
      icon: <IconMovie className="size-5" />,
      titleKey: "qaStoryboardSplit",
      descKey: "qaStoryboardSplitDesc",
      promptKey: "qaStoryboardSplitPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaStoryboardOptimize",
      descKey: "qaStoryboardOptimizeDesc",
      promptKey: "qaStoryboardOptimizePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconMapPin className="size-5" />,
      titleKey: "qaStoryboardTransition",
      descKey: "qaStoryboardTransitionDesc",
      promptKey: "qaStoryboardTransitionPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  character: [
    {
      icon: <IconUser className="size-5" />,
      titleKey: "qaCharacterExtract",
      descKey: "qaCharacterExtractDesc",
      promptKey: "qaCharacterExtractPrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconPencil className="size-5" />,
      titleKey: "qaCharacterDesign",
      descKey: "qaCharacterDesignDesc",
      promptKey: "qaCharacterDesignPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPackage className="size-5" />,
      titleKey: "qaCharacterRelation",
      descKey: "qaCharacterRelationDesc",
      promptKey: "qaCharacterRelationPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  scene: [
    {
      icon: <IconMapPin className="size-5" />,
      titleKey: "qaSceneCreate",
      descKey: "qaSceneCreateDesc",
      promptKey: "qaSceneCreatePrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaSceneAnalyze",
      descKey: "qaSceneAnalyzeDesc",
      promptKey: "qaSceneAnalyzePrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPencil className="size-5" />,
      titleKey: "qaSceneAtmosphere",
      descKey: "qaSceneAtmosphereDesc",
      promptKey: "qaSceneAtmospherePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
  ],
  ad: [
    {
      icon: <IconAd className="size-5" />,
      titleKey: "qaAdScript",
      descKey: "qaAdScriptDesc",
      promptKey: "qaAdScriptPrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconLayoutGrid className="size-5" />,
      titleKey: "qaAdStoryboard",
      descKey: "qaAdStoryboardDesc",
      promptKey: "qaAdStoryboardPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconPackage className="size-5" />,
      titleKey: "qaAdPlatform",
      descKey: "qaAdPlatformDesc",
      promptKey: "qaAdPlatformPrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
  novel: [
    {
      icon: <IconBook2 className="size-5" />,
      titleKey: "qaNovelCreate",
      descKey: "qaNovelCreateDesc",
      promptKey: "qaNovelCreatePrompt",
      colors: ["#f87171", "#fb923c", "#f472b6"],
      glowColor: "0 80 65",
    },
    {
      icon: <IconFileText className="size-5" />,
      titleKey: "qaNovelAdapt",
      descKey: "qaNovelAdaptDesc",
      promptKey: "qaNovelAdaptPrompt",
      colors: ["#a78bfa", "#818cf8", "#38bdf8"],
      glowColor: "250 70 70",
    },
    {
      icon: <IconSparkles className="size-5" />,
      titleKey: "qaNovelExplore",
      descKey: "qaNovelExploreDesc",
      promptKey: "qaNovelExplorePrompt",
      colors: ["#34d399", "#2dd4bf", "#a3e635"],
      glowColor: "160 70 65",
    },
  ],
};

export const MAX_ATTACHMENTS = 1;
