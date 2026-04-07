// ─── Types ───────────────────────────────────────────

export interface Creator {
  id: string;
  name: string;
  level: "FD1" | "FD2" | "FD3" | "FD4" | "FD5";
  skills: string[];
  location: string;
  bio: string;
  projects: number;
  rating: number;
  reviews: number;
  availability: "available" | "this_week" | "by_appointment";
  responseTime: string;
  covers: string[];
  featured?: boolean;
  joinedAt: string;
}

export interface FeedItem {
  id: string;
  type: "levelup" | "tool" | "spotlight" | "news" | "project";
  user: string;
  userLevel: string;
  time: string;
  text: string;
  link?: string;
  likes?: number;
  comments?: number;
}

export interface CertLevel {
  level: string;
  name: string;
  count: number;
  requirements: string[];
  perks: string[];
}

export interface SkillDemand {
  skill: string;
  openRoles: number;
  trend: "up" | "down" | "stable";
}

// ─── Constants ───────────────────────────────────────

export const SKILL_OPTIONS = [
  "All Skills",
  "AI Art",
  "Storyboard",
  "Screenwriter",
  "Voice Acting",
  "Post-production",
  "Music",
  "Director",
  "Scene Design",
  "Character Design",
];

export const LEVEL_OPTIONS = ["All Levels", "FD1", "FD2", "FD3", "FD4", "FD5"];

export const SORT_OPTIONS = [
  { value: "rating", label: "Highest Rated" },
  { value: "projects", label: "Most Projects" },
  { value: "recent", label: "Recently Active" },
];

export const LEVEL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  FD1: { text: "text-slate-400", bg: "bg-slate-400/10", border: "border-slate-400/30" },
  FD2: { text: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/30" },
  FD3: { text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/30" },
  FD4: { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30" },
  FD5: { text: "text-primary", bg: "bg-primary/10", border: "border-primary/30" },
};

export const AVAILABILITY_CONFIG: Record<string, { dot: string; text: string; label: string }> = {
  available: { dot: "bg-green-400", text: "text-green-400", label: "Available Now" },
  this_week: { dot: "bg-blue-400", text: "text-blue-400", label: "This Week" },
  by_appointment: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    label: "By Appointment",
  },
};

// ─── Mock Data ───────────────────────────────────────

export const MOCK_STATS = {
  activeCreators: 2400,
  openRoles: 340,
  activeStudios: 128,
  completedProjects: 892,
};

export const MOCK_HOT_SKILLS = [
  "AI Art",
  "Storyboard",
  "Voice Acting",
  "Screenwriter",
  "Post-production",
  "Music",
];

export const MOCK_CREATORS: Creator[] = [
  {
    id: "c1",
    name: "Momo_Creator",
    level: "FD3",
    skills: ["AI Art", "Character Design", "Storyboard"],
    location: "Shanghai",
    bio: "Specializes in blending Eastern aesthetics with cyberpunk style. Representative work 'Neon Dragon' has over 1M views.",
    projects: 14,
    rating: 4.9,
    reviews: 28,
    availability: "available",
    responseTime: "< 1hr",
    covers: [
      "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400&q=70",
      "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=400&q=70",
    ],
    featured: true,
    joinedAt: "2024-03",
  },
  {
    id: "c2",
    name: "Pax_Storyboarder",
    level: "FD4",
    skills: ["Storyboard", "Director", "Scene Design"],
    location: "Beijing",
    bio: "10-year commercial director turned AI creator. Expert in post-apocalyptic scene design, proficient in camera language.",
    projects: 22,
    rating: 5.0,
    reviews: 41,
    availability: "this_week",
    responseTime: "< 2hrs",
    covers: [
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400&q=70",
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=70",
    ],
    featured: true,
    joinedAt: "2023-11",
  },
  {
    id: "c3",
    name: "Galaxy Writer",
    level: "FD3",
    skills: ["Screenwriter", "AI Art"],
    location: "Guangzhou",
    bio: "Focuses on sci-fi and mystery genres, completed 6 scripts. Expert in world-building and character arc design.",
    projects: 8,
    rating: 4.7,
    reviews: 15,
    availability: "by_appointment",
    responseTime: "< 4hrs",
    covers: [
      "https://images.unsplash.com/photo-1545665277-5937489579f2?w=400&q=70",
      "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=70",
    ],
    joinedAt: "2024-06",
  },
  {
    id: "c4",
    name: "Ghost Voice",
    level: "FD2",
    skills: ["Voice Acting", "Music"],
    location: "Chengdu",
    bio: "Professional voice actor skilled in various vocal tones, equipped with professional recording studio, fast delivery.",
    projects: 31,
    rating: 4.8,
    reviews: 52,
    availability: "available",
    responseTime: "< 30min",
    covers: [
      "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&q=70",
      "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400&q=70",
    ],
    joinedAt: "2024-01",
  },
  {
    id: "c5",
    name: "Pixel Post",
    level: "FD3",
    skills: ["Post-production", "Scene Design"],
    location: "Shenzhen",
    bio: "Expert in DaVinci color grading and After Effects VFX, a leading post-production creator in the cyberpunk visual style.",
    projects: 18,
    rating: 4.9,
    reviews: 33,
    availability: "this_week",
    responseTime: "< 2hrs",
    covers: [
      "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400&q=70",
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400&q=70",
    ],
    joinedAt: "2024-02",
  },
  {
    id: "c6",
    name: "Chang'an Musician",
    level: "FD4",
    skills: ["Music"],
    location: "Xi'an",
    bio: "Classical and electronic music fusion creator, composed original scores for 30+ AI short dramas, multiple awards.",
    projects: 35,
    rating: 5.0,
    reviews: 67,
    availability: "by_appointment",
    responseTime: "< 6hrs",
    covers: [
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=70",
      "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=400&q=70",
    ],
    featured: true,
    joinedAt: "2023-08",
  },
  {
    id: "c7",
    name: "NeoFrame",
    level: "FD2",
    skills: ["AI Art", "Storyboard"],
    location: "Hangzhou",
    bio: "Obsessed with cinematic composition, blending 2.5D illustration with AI generation. Known for dynamic action sequences.",
    projects: 9,
    rating: 4.6,
    reviews: 12,
    availability: "available",
    responseTime: "< 1hr",
    covers: [
      "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=70",
      "https://images.unsplash.com/photo-1545665277-5937489579f2?w=400&q=70",
    ],
    joinedAt: "2024-09",
  },
  {
    id: "c8",
    name: "Verse Director",
    level: "FD3",
    skills: ["Director", "Screenwriter", "Storyboard"],
    location: "Chongqing",
    bio: "Former short film festival award winner. Specializes in emotional storytelling with tight pacing and symbolic motifs.",
    projects: 16,
    rating: 4.8,
    reviews: 24,
    availability: "this_week",
    responseTime: "< 3hrs",
    covers: [
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400&q=70",
      "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&q=70",
    ],
    joinedAt: "2024-04",
  },
];

export const MOCK_FEED: FeedItem[] = [
  {
    id: "f1",
    type: "levelup",
    user: "Momo_Creator",
    userLevel: "FD3",
    time: "2 hours ago",
    text: "Congrats to Momo_Creator for leveling up to FD3 Professional Creator! 14 projects completed.",
    likes: 42,
    comments: 8,
  },
  {
    id: "f2",
    type: "tool",
    user: "FizzDragon Official",
    userLevel: "FD5",
    time: "5 hours ago",
    text: "New tool launched: LoRA Style Transfer Model Library, supporting one-click loading of 200+ styles.",
    likes: 128,
    comments: 23,
  },
  {
    id: "f3",
    type: "spotlight",
    user: "Pax_Storyboarder",
    userLevel: "FD4",
    time: "1 day ago",
    text: "Pax_Storyboarder's scene design \"Wasteland Station\" was selected as this week's featured work.",
    likes: 256,
    comments: 34,
  },
  {
    id: "f4",
    type: "project",
    user: "Studio Nebula",
    userLevel: "FD4",
    time: "1 day ago",
    text: 'New project "Crimson Tide" is recruiting: AI Artist, Storyboarder, and Voice Actor needed. Budget: $2,800.',
    likes: 67,
    comments: 15,
  },
  {
    id: "f5",
    type: "news",
    user: "FizzDragon Official",
    userLevel: "FD5",
    time: "2 days ago",
    text: "FizzDragon Vietnam creator community officially launched, 30 Southeast Asian creators joined.",
    likes: 89,
    comments: 12,
  },
  {
    id: "f6",
    type: "levelup",
    user: "Galaxy Writer",
    userLevel: "FD3",
    time: "3 days ago",
    text: "Congrats to Galaxy Writer for leveling up to FD3! Focused on sci-fi and mystery genre creation.",
    likes: 38,
    comments: 6,
  },
];

export const MOCK_CERT_LEVELS: CertLevel[] = [
  {
    level: "FD1",
    name: "Entry Creator",
    count: 1842,
    requirements: ["Complete registration & verification", "Pass basic skills test"],
    perks: ["Accept tasks up to $70", "Basic community access"],
  },
  {
    level: "FD2",
    name: "Regular Creator",
    count: 723,
    requirements: ["Complete 5 projects", "Rating >= 85%", "Pass FD2 review"],
    perks: ["Tasks up to $280", "Works in recommendation pool", "Collaboration tools"],
  },
  {
    level: "FD3",
    name: "Professional",
    count: 214,
    requirements: ["Complete 15 projects", "Rating >= 92%", "Portfolio expert review"],
    perks: ["Tasks up to $1,400", "Certified badge", "Priority exposure", "Create teams"],
  },
  {
    level: "FD4",
    name: "Master Creator",
    count: 56,
    requirements: ["Complete 30 projects", "Rating >= 96%", "Featured 3+ times"],
    perks: ["No task limit", "Exclusive promotion", "Mentor qualification", "15% revenue bonus"],
  },
  {
    level: "FD5",
    name: "Legendary",
    count: 12,
    requirements: [
      "Complete 50 projects",
      "Rating >= 98%",
      "Annual award winner",
      "FD Committee invitation",
    ],
    perks: ["Partner benefits", "Brand page", "VIP events", "30% revenue bonus"],
  },
];

export const MOCK_SKILL_DEMANDS: SkillDemand[] = [
  { skill: "AI Art", openRoles: 89, trend: "up" },
  { skill: "Storyboard", openRoles: 64, trend: "up" },
  { skill: "Voice Acting", openRoles: 52, trend: "stable" },
  { skill: "Screenwriter", openRoles: 41, trend: "up" },
  { skill: "Post-production", openRoles: 38, trend: "down" },
  { skill: "Music", openRoles: 27, trend: "stable" },
];

// ─── API Interface Spec (for future backend) ─────────
//
// GET  /api/creators                   → Creator[]      (query: skill, level, availability, sort, page, pageSize, keyword)
// GET  /api/creators/:id               → Creator        (creator detail with portfolio)
// GET  /api/creators/featured          → Creator[]      (spotlight / featured creators)
// GET  /api/creators/stats             → Stats          (activeCreators, openRoles, etc.)
// GET  /api/community/feed             → FeedItem[]     (query: type, page, pageSize)
// GET  /api/certification/levels       → CertLevel[]    (all FD certification levels)
// GET  /api/skills/demand              → SkillDemand[]  (current skill demand stats)
// POST /api/creators/:id/invite        → void           (send invitation to creator)
// POST /api/community/feed/:id/like    → void           (like a feed item)
