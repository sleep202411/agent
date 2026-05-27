export type HeroSlide = {
  key: string;
  imageUrl: string;
  accent: string;
  active?: boolean;
};

export const HERO_SLIDES: HeroSlide[] = [
  {
    key: "challenge",
    imageUrl:
      "https://images.unsplash.com/photo-1659733582156-d2a11801e59f?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#e52227]",
    active: true,
  },
  {
    key: "collaboration",
    imageUrl:
      "https://images.unsplash.com/photo-1543362137-5df0547b039d?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#37d4c7]",
  },
  {
    key: "membership",
    imageUrl:
      "https://images.unsplash.com/photo-1631142260228-305ccb610dba?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#f0b45d]",
  },
  {
    key: "seeddance",
    imageUrl:
      "https://images.unsplash.com/photo-1708022766976-49ca46c0f7de?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#7dd3fc]",
  },
  {
    key: "storyboard",
    imageUrl:
      "https://images.unsplash.com/photo-1631142260079-970258649676?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#c084fc]",
  },
  {
    key: "assetReview",
    imageUrl:
      "https://images.unsplash.com/photo-1708022809820-2668e65877b9?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#fb7185]",
  },
  {
    key: "modelLab",
    imageUrl:
      "https://images.unsplash.com/photo-1708022796522-ff65b57439de?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#a3e635]",
  },
  {
    key: "launchPack",
    imageUrl:
      "https://images.unsplash.com/photo-1708022790103-a514cb89a034?q=70&w=1800&auto=format&fit=crop",
    accent: "bg-[#f97316]",
  },
];

export type ProjectStatus = "active" | "review" | "draft";

export type ProjectCard = {
  key: string;
  status: ProjectStatus;
  progress: number;
  updatedAt: string;
  tone: string;
};

export const PROJECT_CARDS: ProjectCard[] = [
  {
    key: "neonDragon",
    status: "active",
    progress: 72,
    updatedAt: "12m",
    tone: "from-[#111827] via-[#4b5563] to-[#f97316]",
  },
  {
    key: "skyMarket",
    status: "review",
    progress: 48,
    updatedAt: "1h",
    tone: "from-[#172554] via-[#2563eb] to-[#fde68a]",
  },
  {
    key: "moonCourier",
    status: "draft",
    progress: 26,
    updatedAt: "Yesterday",
    tone: "from-[#064e3b] via-[#0f766e] to-[#d9f99d]",
  },
];

export type CategoryKey =
  | "all"
  | "shortFilm"
  | "commercial"
  | "animation"
  | "mv"
  | "education"
  | "toolkit";

export const SHOW_CATEGORIES: CategoryKey[] = [
  "all",
  "shortFilm",
  "commercial",
  "animation",
  "mv",
  "education",
  "toolkit",
];

export type ShowWork = {
  key: string;
  author: string;
  badge?: "featured" | "pro" | "honor";
  tone: string;
};

export const SHOW_WORKS: ShowWork[] = [
  {
    key: "clueBie",
    author: "像素暗室",
    badge: "featured",
    tone: "from-[#0f172a] via-[#312e81] to-[#f0abfc]",
  },
  {
    key: "boneExchange",
    author: "都都沉Doc",
    badge: "pro",
    tone: "from-[#0f2925] via-[#0f766e] to-[#67e8f9]",
  },
  {
    key: "tailCompany",
    author: "Tassi",
    badge: "honor",
    tone: "from-[#f59e0b] via-[#f97316] to-[#111827]",
  },
  {
    key: "frostWar",
    author: "Ai洪水汤汤",
    badge: "pro",
    tone: "from-[#020617] via-[#334155] to-[#cbd5e1]",
  },
  {
    key: "automata",
    author: "牛斗",
    badge: "featured",
    tone: "from-[#1f2937] via-[#64748b] to-[#facc15]",
  },
  {
    key: "worldBurns",
    author: "啊毛",
    badge: "honor",
    tone: "from-[#db2777] via-[#7c3aed] to-[#f97316]",
  },
  {
    key: "greenKitchen",
    author: "157****9603",
    tone: "from-[#14532d] via-[#65a30d] to-[#d9f99d]",
  },
  {
    key: "iphoneSpot",
    author: "星曜AG",
    badge: "pro",
    tone: "from-[#111827] via-[#1f2937] to-[#f97316]",
  },
];
