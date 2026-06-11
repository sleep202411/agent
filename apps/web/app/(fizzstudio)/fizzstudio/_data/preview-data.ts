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

export type ProjectPreviewAsset = {
  accentColor: string;
  objectPosition?: string;
  posterUrl: string;
};

export const PROJECT_PREVIEW_ASSETS: ProjectPreviewAsset[] = [
  {
    posterUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#8fd7ff",
    objectPosition: "center 42%",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#67e8f9",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#fbbf24",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#c7d2fe",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1518331647614-7a1f04cd34cf?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#a3e635",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#fb7185",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#86efac",
  },
  {
    posterUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1200&auto=format&fit=crop",
    accentColor: "#f97316",
  },
];

export type EnterpriseHeroAsset = {
  className: string;
  imageUrl: string;
};

export const ENTERPRISE_HERO_ASSETS: EnterpriseHeroAsset[] = [
  {
    imageUrl:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=360&auto=format&fit=crop",
    className: "right-[15%] top-4 size-[86px]",
  },
  {
    imageUrl:
      "https://images.unsplash.com/photo-1528740561666-dc2479dc08ab?q=80&w=320&auto=format&fit=crop",
    className: "right-0 top-8 size-[74px]",
  },
  {
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=360&auto=format&fit=crop",
    className: "right-[32%] top-[118px] h-[68px] w-[116px]",
  },
  {
    imageUrl:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=360&auto=format&fit=crop",
    className: "right-[9%] top-[138px] h-[74px] w-[116px]",
  },
  {
    imageUrl:
      "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?q=80&w=360&auto=format&fit=crop",
    className: "right-[1%] top-[118px] h-[76px] w-[76px]",
  },
];

export type EnterpriseNewsItem = {
  imageUrl: string;
  key: string;
  mode?: "light" | "media" | "panel";
  objectPosition?: string;
};

export const ENTERPRISE_NEWS_ITEMS: EnterpriseNewsItem[] = [
  { key: "simpleMode", imageUrl: "", mode: "light" },
  {
    key: "seedance",
    imageUrl:
      "https://images.unsplash.com/photo-1511497584788-876760111969?q=80&w=1100&auto=format&fit=crop",
    mode: "media",
  },
  { key: "multiShots", imageUrl: "", mode: "panel" },
  {
    key: "klingElements",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1100&auto=format&fit=crop",
    mode: "media",
    objectPosition: "center 44%",
  },
  {
    key: "imageIterator",
    imageUrl:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1100&auto=format&fit=crop",
    mode: "media",
  },
  {
    key: "gptImage",
    imageUrl:
      "https://images.unsplash.com/photo-1518331647614-7a1f04cd34cf?q=80&w=1100&auto=format&fit=crop",
    mode: "media",
  },
];

export type EnterpriseTemplateCategory =
  | "campaigns"
  | "cinematic"
  | "advertising"
  | "fashion"
  | "branding"
  | "editing";

export const ENTERPRISE_TEMPLATE_CATEGORIES: EnterpriseTemplateCategory[] = [
  "campaigns",
  "cinematic",
  "advertising",
  "fashion",
  "branding",
  "editing",
];

export type EnterpriseTemplateCard = {
  category: EnterpriseTemplateCategory;
  imageUrl: string;
  key: string;
  objectPosition?: string;
};

export const ENTERPRISE_TEMPLATE_CARDS: EnterpriseTemplateCard[] = [
  {
    key: "musicVideoProduction",
    category: "cinematic",
    imageUrl:
      "https://images.unsplash.com/photo-1518611012118-696072aa579a?q=80&w=900&auto=format&fit=crop",
    objectPosition: "center 45%",
  },
  {
    key: "bmwCommercial",
    category: "advertising",
    imageUrl:
      "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=900&auto=format&fit=crop",
    objectPosition: "center 40%",
  },
  {
    key: "animeActionShots",
    category: "cinematic",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=900&auto=format&fit=crop",
    objectPosition: "center 44%",
  },
  {
    key: "snookerFavourites",
    category: "campaigns",
    imageUrl:
      "https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?q=80&w=900&auto=format&fit=crop",
  },
  {
    key: "porscheWashAd",
    category: "advertising",
    imageUrl:
      "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=900&auto=format&fit=crop",
  },
  {
    key: "youtubeVlog",
    category: "branding",
    imageUrl:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=900&auto=format&fit=crop",
    objectPosition: "center 38%",
  },
  {
    key: "cookieFight",
    category: "editing",
    imageUrl:
      "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?q=80&w=900&auto=format&fit=crop",
  },
  {
    key: "fashionFilm",
    category: "fashion",
    imageUrl:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?q=80&w=900&auto=format&fit=crop",
  },
];

export type EnterpriseGuideCard = {
  imageUrl: string;
  key: string;
  objectPosition?: string;
};

export const ENTERPRISE_GUIDE_CARDS: EnterpriseGuideCard[] = [
  {
    key: "fashionIndustry",
    imageUrl:
      "https://images.unsplash.com/photo-1496747611176-843222e1e57c?q=80&w=900&auto=format&fit=crop",
  },
  {
    key: "coffeeCampaign",
    imageUrl:
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?q=80&w=900&auto=format&fit=crop",
  },
  {
    key: "launchStoryboard",
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=900&auto=format&fit=crop",
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
  authorKey: string;
  badge?: "featured" | "pro" | "honor";
  category: Exclude<CategoryKey, "all">;
  posterUrl: string;
  accentColor: string;
  duration: string;
  currentTime: string;
  progress: number;
  featured?: boolean;
  objectPosition?: string;
};

export const SHOW_WORKS: ShowWork[] = [
  {
    key: "clueBie",
    authorKey: "pixelDarkroom",
    badge: "featured",
    category: "shortFilm",
    posterUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#8fd7ff",
    duration: "01:18",
    currentTime: "00:08",
    progress: 10,
    objectPosition: "center 42%",
  },
  {
    key: "boneExchange",
    authorKey: "duduDoc",
    badge: "pro",
    category: "animation",
    posterUrl:
      "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#67e8f9",
    duration: "00:47",
    currentTime: "00:12",
    progress: 26,
  },
  {
    key: "tailCompany",
    authorKey: "tassi",
    badge: "honor",
    category: "commercial",
    posterUrl:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#fbbf24",
    duration: "00:59",
    currentTime: "00:19",
    progress: 32,
  },
  {
    key: "frostWar",
    authorKey: "aiFlood",
    badge: "pro",
    category: "shortFilm",
    posterUrl:
      "https://images.unsplash.com/photo-1483347756197-71ef80e95f73?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#c7d2fe",
    duration: "01:34",
    currentTime: "00:41",
    progress: 44,
    featured: true,
  },
  {
    key: "automata",
    authorKey: "niuDou",
    badge: "featured",
    category: "animation",
    posterUrl:
      "https://images.unsplash.com/photo-1518331647614-7a1f04cd34cf?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#a3e635",
    duration: "01:06",
    currentTime: "00:24",
    progress: 36,
  },
  {
    key: "worldBurns",
    authorKey: "aMao",
    badge: "honor",
    category: "mv",
    posterUrl:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#fb7185",
    duration: "00:52",
    currentTime: "00:17",
    progress: 33,
  },
  {
    key: "greenKitchen",
    authorKey: "maskedChef",
    category: "education",
    posterUrl:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#86efac",
    duration: "00:36",
    currentTime: "00:04",
    progress: 12,
  },
  {
    key: "iphoneSpot",
    authorKey: "xingyaoAg",
    badge: "pro",
    category: "toolkit",
    posterUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1400&auto=format&fit=crop",
    accentColor: "#f97316",
    duration: "00:30",
    currentTime: "00:11",
    progress: 37,
  },
];
