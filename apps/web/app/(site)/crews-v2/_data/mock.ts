/**
 * Mock fixtures for `/crews-v2`. Direct port of the PRD `app/studio`
 * page's hardcoded data. When real APIs land, swap each export for
 * a React Query hook returning the same shape.
 */

export interface Studio {
  id: string;
  name: string;
  ip_name: string;
  project_type: string;
  status: "Recruiting" | "In Production" | "Post-production" | "Completed";
  current_phase: string;
  description: string;
  progress: number;
  member_count: number;
  producer_name: string;
  budget_range: string;
  deadline: string;
  roles_needed: string[];
  cover_image: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  phase: string;
  progress: number;
  budget: number;
  spent: number;
  members: number;
  urgentCheckpoints: number;
  pendingTasks: number;
  deadline: string;
  health: "good" | "warning" | "risk";
}

export interface PendingApproval {
  id: string;
  project: string;
  stage: string;
  /** "6h until timeout" / "Due tomorrow" — pre-localized in the page. */
  slaKey: "hoursUntilTimeout" | "dueTomorrow";
  slaHours?: number;
  urgent: boolean;
}

export const STATUS_TABS = ["All", "Recruiting", "In Production", "Post-production"] as const;
export const ROLE_FILTERS = [
  "AI Art",
  "Storyboarder",
  "Voice Actor",
  "Post Editor",
  "Music",
  "Screenwriter",
] as const;

export const MOCK_STUDIOS: Studio[] = [
  {
    id: "1",
    name: "Cyber Shanhaijing Trailer Team",
    ip_name: "Cyber Shanhaijing",
    project_type: "IP Dev",
    status: "Recruiting",
    current_phase: "Storyboarding",
    description: "Character design and trailer in progress, recruiting Storyboarder and AI Art",
    progress: 35,
    member_count: 6,
    producer_name: "Shadow Producer",
    budget_range: "¥3k-8k",
    deadline: "2026-04-10",
    roles_needed: ["Storyboarder", "AI Art", "Voice", "Post-prod"],
    cover_image: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600&q=80",
  },
  {
    id: "2",
    name: "Deep Harbor Brand Film Team",
    ip_name: "Deep Harbor",
    project_type: "Brand Film",
    status: "In Production",
    current_phase: "Video Gen",
    description: "First Rough Cut complete, now recruiting Voice and Post-prod Colorist",
    progress: 62,
    member_count: 9,
    producer_name: "Wave Director",
    budget_range: "¥5k-12k",
    deadline: "2026-04-03",
    roles_needed: ["Voice", "Colorist", "Mixer"],
    cover_image: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=600&q=80",
  },
  {
    id: "3",
    name: "Neon Memories MV Team",
    ip_name: "Neon Memories",
    project_type: "Creative Lab",
    status: "Post-production",
    current_phase: "Fine Cut",
    description: "Cyberpunk-style MV, main shoot complete, now recruiting Fine Cut Editor",
    progress: 78,
    member_count: 5,
    producer_name: "Neon Squad",
    budget_range: "¥2k-5k",
    deadline: "2026-03-30",
    roles_needed: ["Fine Cut Editor", "Subtitle"],
    cover_image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&q=80",
  },
  {
    id: "4",
    name: "Void Legends 10-ep Animation",
    ip_name: "Void Legends",
    project_type: "Series",
    status: "Recruiting",
    current_phase: "Design Phase",
    description: "10-ep AI animation, building core creative team",
    progress: 15,
    member_count: 3,
    producer_name: "Void Productions",
    budget_range: "¥8k-20k",
    deadline: "2026-05-15",
    roles_needed: ["Screenwriter", "Character Design", "Storyboarder", "AI Art", "Asst. Director"],
    cover_image: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=600&q=80",
  },
  {
    id: "5",
    name: "Algorithm Goddess Commercial",
    ip_name: "Algorithm Goddess",
    project_type: "Commercial",
    status: "In Production",
    current_phase: "Voice & Music",
    description:
      "AI aesthetics Commercial, main video complete, recruiting Voice Actor and original Music Producer",
    progress: 55,
    member_count: 7,
    producer_name: "Digital Muse",
    budget_range: "¥6k-15k",
    deadline: "2026-04-07",
    roles_needed: ["Voice Actor", "Music Producer"],
    cover_image: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600&q=80",
  },
  {
    id: "6",
    name: "Doomsday Survivors Pilot",
    ip_name: "Doomsday Survivors",
    project_type: "IP Dev",
    status: "Recruiting",
    current_phase: "Rough Cut",
    description: "Post-apocalyptic AI pilot, recruiting editor for first episode",
    progress: 48,
    member_count: 8,
    producer_name: "Doomsday Workshop",
    budget_range: "¥4k-10k",
    deadline: "2026-04-20",
    roles_needed: ["Editor", "Subtitle", "Post-prod"],
    cover_image: "https://images.unsplash.com/photo-1545665277-5937489579f2?w=600&q=80",
  },
];

export const PLATFORM_STATS = [
  { labelKey: "statActiveStudios" as const, value: "128" },
  { labelKey: "statOpenRoles" as const, value: "340+" },
  { labelKey: "statCreators" as const, value: "2.4k" },
  { labelKey: "statCompletedProjects" as const, value: "89" },
];

export const PROJECTS: ProjectRow[] = [
  {
    id: "1",
    name: "Cyber Shanhaijing Trailer Team",
    status: "In Production",
    phase: "Storyboarding",
    progress: 35,
    budget: 28000,
    spent: 9800,
    members: 6,
    urgentCheckpoints: 1,
    pendingTasks: 3,
    deadline: "2026-04-10",
    health: "warning",
  },
  {
    id: "2",
    name: "Deep HarborBrand Film",
    status: "In Production",
    phase: "Video Gen",
    progress: 62,
    budget: 45000,
    spent: 28500,
    members: 4,
    urgentCheckpoints: 0,
    pendingTasks: 1,
    deadline: "2026-04-22",
    health: "good",
  },
  {
    id: "3",
    name: "Algorithm Goddess OST",
    status: "Not Started",
    phase: "Design Phase",
    progress: 5,
    budget: 12000,
    spent: 0,
    members: 2,
    urgentCheckpoints: 0,
    pendingTasks: 0,
    deadline: "2026-05-01",
    health: "good",
  },
];

export const PENDING_APPROVALS: PendingApproval[] = [
  {
    id: "cp2",
    project: "Cyber Shanhaijing",
    stage: "Storyboard",
    slaKey: "hoursUntilTimeout",
    slaHours: 6,
    urgent: true,
  },
  {
    id: "cp5",
    project: "Deep Harbor",
    stage: "AI Image Gen",
    slaKey: "dueTomorrow",
    urgent: false,
  },
];

export const FINANCIAL_SUMMARY = {
  totalBudget: 85000,
  totalSpent: 38300,
  escrowHeld: 22400,
  pendingRelease: 8500,
};

/* ────────────────────────────────────────────────────────────────────
 * Workspace ([id]/workspace) fixtures
 * Direct port of PRD `app/studio/[id]/workspace/page.tsx` + EpisodeAccordion.
 * Status / EP-status / member-status values are kept as English literals
 * (mapped to i18n keys at render time); names / dates / role labels live
 * here as content strings.
 * ────────────────────────────────────────────────────────────────────*/

export type MemberStatus = "approved" | "submitted" | "in_progress" | "rejected";

export interface WorkspaceMember {
  name: string;
  role: string;
  status: MemberStatus;
  /** Mock relative-time string ("2 hours ago" / "Yesterday" / "2026-03-08") */
  updated?: string;
}

export interface WorkspaceEpisode {
  ep: number;
  label: string;
  status: "Completed" | "In Progress" | "Not Started";
  isCurrent?: boolean;
  members: number;
  passed: number;
  pending: number;
  clientStatus: "Client Confirmed" | "Not Submitted";
  membersList: WorkspaceMember[];
  activity: { text: string; time: string }[];
  lastUpdated: string;
}

export const WORKSPACE_STUDIO = {
  name: "Cyber Shanhaijing",
  status: "In Production",
  type: "AI Short Drama",
  tags: ["Suspense", "Cyberpunk"],
  client: "Phantom Media",
  producer: "Shadow Producer",
  currentEpisode: 3,
  totalEpisodes: 6,
  lastUpdated: "2 hours ago",
  memberCount: 12,
  slotsTotal: 10,
  slotsFilled: 8,
  currentEpMembers: 6,
  todoCount: 3,
  remainingIncomplete: 2,
  deadline: "2026-03-30",
};

export const WORKSPACE_CURRENT_EP_MEMBERS: WorkspaceMember[] = [
  { name: "Zhang San", role: "Screenwriter", status: "approved" },
  { name: "Li Si", role: "AI Artist", status: "submitted" },
  { name: "Wang Wu", role: "Voice", status: "in_progress" },
  { name: "Zhao Liu", role: "Editor", status: "rejected" },
];

export const WORKSPACE_ROLES_PROGRESS = [
  { role: "Screenwriter", filled: 1, total: 1 },
  { role: "AI Artist", filled: 2, total: 3 },
  { role: "Voice", filled: 4, total: 4 },
  { role: "Editor", filled: 1, total: 1 },
];

export const WORKSPACE_TODOS: { text: string; urgent: boolean }[] = [
  { text: "Li Si submission pending review", urgent: true },
  { text: "Wang Wu has not yet submitted", urgent: true },
  { text: "Episode 2 client feedback requires revisions", urgent: false },
];

export const WORKSPACE_ACTIVITY: { text: string; time: string }[] = [
  { text: "Zhang San submitted Episode 3 script", time: "1 hour ago" },
  { text: "Client approved Episode 2", time: "3 hours ago" },
  { text: "Hired 1 new Voice Actor", time: "Yesterday" },
  { text: "Episode 3 storyboard has begun production", time: "Yesterday" },
];

export const WORKSPACE_DELIVERY_HISTORY: {
  ep: string;
  date: string;
  status: "Client Confirmed" | "Revising";
}[] = [
  { ep: "Episode 1", date: "2026-02-10", status: "Client Confirmed" },
  { ep: "Episode 2", date: "2026-03-01", status: "Revising" },
];

export const WORKSPACE_EPISODES: WorkspaceEpisode[] = [
  {
    ep: 1,
    label: "EP1",
    status: "Completed",
    members: 4,
    passed: 4,
    pending: 0,
    clientStatus: "Client Confirmed",
    lastUpdated: "2026-03-08",
    membersList: [
      { name: "Zhang San", role: "Screenwriter", status: "approved", updated: "2026-03-08" },
      { name: "Li Si", role: "AI Image Gen", status: "approved", updated: "2026-03-07" },
      { name: "Wang Wu", role: "Voice", status: "approved", updated: "2026-03-07" },
      { name: "Zhao Liu", role: "Editor", status: "approved", updated: "2026-03-08" },
    ],
    activity: [
      { text: "Client confirmed EP1", time: "2026-03-08" },
      { text: "Producer completed review", time: "2026-03-07" },
    ],
  },
  {
    ep: 2,
    label: "EP2",
    status: "Completed",
    members: 5,
    passed: 5,
    pending: 0,
    clientStatus: "Client Confirmed",
    lastUpdated: "2026-03-15",
    membersList: [
      { name: "Zhang San", role: "Screenwriter", status: "approved", updated: "2026-03-14" },
      { name: "Li Si", role: "AI Image Gen", status: "approved", updated: "2026-03-13" },
      { name: "Wang Wu", role: "Voice", status: "approved", updated: "2026-03-13" },
      { name: "Zhao Liu", role: "Editor", status: "approved", updated: "2026-03-15" },
      { name: "Xiao Lin", role: "Character Design", status: "approved", updated: "2026-03-12" },
    ],
    activity: [
      { text: "Client confirmed EP2", time: "2026-03-15" },
      { text: "Producer completed review", time: "2026-03-14" },
    ],
  },
  {
    ep: 3,
    label: "EP3",
    status: "In Progress",
    isCurrent: true,
    members: 6,
    passed: 3,
    pending: 2,
    clientStatus: "Not Submitted",
    lastUpdated: "2 hours ago",
    membersList: [
      { name: "Zhang San", role: "Screenwriter", status: "approved", updated: "2 hours ago" },
      { name: "Li Si", role: "AI Image Gen", status: "submitted", updated: "1 hour ago" },
      { name: "Wang Wu", role: "Voice", status: "in_progress", updated: "3 hours ago" },
      { name: "Zhao Liu", role: "Editor", status: "rejected", updated: "Yesterday" },
      { name: "Xiao Lin", role: "Character Design", status: "approved", updated: "Yesterday" },
      { name: "A Jie", role: "Scene Design", status: "approved", updated: "Yesterday" },
    ],
    activity: [
      { text: "Zhang San submitted EP3 script", time: "2 hours ago" },
      { text: "Li Si updated image gen plan v2", time: "1 hour ago" },
      { text: "Zhao Liu's edit draft was rejected", time: "Yesterday" },
      { text: "Client has not received confirmation submission for this episode", time: "" },
    ],
  },
  {
    ep: 4,
    label: "EP4",
    status: "Not Started",
    members: 0,
    passed: 0,
    pending: 0,
    clientStatus: "Not Submitted",
    lastUpdated: "—",
    membersList: [],
    activity: [],
  },
  {
    ep: 5,
    label: "EP5",
    status: "Not Started",
    members: 0,
    passed: 0,
    pending: 0,
    clientStatus: "Not Submitted",
    lastUpdated: "—",
    membersList: [],
    activity: [],
  },
];

/* ────────────────────────────────────────────────────────────────────
 * Detail page ([id]) fixtures
 * Direct port of PRD `app/studio/[id]/page.tsx`. Phase / status values
 * stay as English literals; phase labels map to i18n keys at render.
 * ────────────────────────────────────────────────────────────────────*/

export type PhaseId =
  | "Worldbuilding"
  | "Character Design"
  | "Scene Design"
  | "Storyboarding"
  | "Video Gen"
  | "Voice & Music"
  | "Rough Cut"
  | "Fine Cut & Release";

export interface DetailRole {
  name: string;
  count: number;
  budget: string;
  period: string;
  deadline: string;
  skills: string[];
  deliverable: string;
}

export interface DetailMember {
  name: string;
  role: string;
  level: string;
}

export interface DetailPhase {
  id: PhaseId;
  done: boolean;
  active?: boolean;
}

export const DETAIL_STUDIO = {
  id: "1",
  name: "Cyber Shanhaijing Trailer Team",
  ip_name: "Cyber Shanhaijing",
  project_type: "IP Dev",
  status: "Recruiting" as const,
  current_phase: "Storyboarding" as PhaseId,
  description: "Character design and trailer in progress, recruiting Storyboarder and AI Art",
  full_description:
    "Cyber Shanhaijing is an AI animated short drama blending Chinese traditional mythology with cyberpunk aesthetics. The Trailer Team is responsible for producing a 2-minute promotional trailer showcasing the worldbuilding and core characters. Character design is currently 70% complete, storyboarding is in progress, and the next phase will launch AI video generation and voice recording.",
  progress: 35,
  member_count: 6,
  producer_name: "Shadow Producer",
  budget_range: "¥3k-8k",
  deadline: "2026-04-10",
  roles_needed: ["Storyboarder", "AI Art", "Voice", "Post-prod"],
  cover_image: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=1200&q=80",
};

export const DETAIL_PHASES: DetailPhase[] = [
  { id: "Worldbuilding", done: true },
  { id: "Character Design", done: true },
  { id: "Scene Design", done: true },
  { id: "Storyboarding", done: false, active: true },
  { id: "Video Gen", done: false },
  { id: "Voice & Music", done: false },
  { id: "Rough Cut", done: false },
  { id: "Fine Cut & Release", done: false },
];

export const DETAIL_PHASE_KEY: Record<PhaseId, string> = {
  Worldbuilding: "dtPhaseWorldbuilding",
  "Character Design": "dtPhaseCharacterDesign",
  "Scene Design": "dtPhaseSceneDesign",
  Storyboarding: "dtPhaseStoryboarding",
  "Video Gen": "dtPhaseVideoGen",
  "Voice & Music": "dtPhaseVoiceMusic",
  "Rough Cut": "dtPhaseRoughCut",
  "Fine Cut & Release": "dtPhaseFineCutRelease",
};

export const DETAIL_ROLES: DetailRole[] = [
  {
    name: "Storyboarder",
    count: 1,
    budget: "¥1500-3000",
    period: "2 weeks",
    deadline: "2026-04-01",
    skills: ["Storyboard Drawing", "Storyboard", "Camera Language"],
    deliverable: "60-panel storyboard draft + annotations",
  },
  {
    name: "AI Artist",
    count: 2,
    budget: "¥2000-4000",
    period: "3 weeks",
    deadline: "2026-04-05",
    skills: ["Midjourney", "Stable Diffusion", "Character Design"],
    deliverable: "Refined character art x 10 sets + Prompt pack",
  },
  {
    name: "Voice Actor",
    count: 3,
    budget: "¥500-1500/role",
    period: "1 week",
    deadline: "2026-04-08",
    skills: ["Professional Voice Acting", "Recording Equipment"],
    deliverable: "WAV recording files + backup versions",
  },
  {
    name: "Post Editor",
    count: 1,
    budget: "¥2000-3500",
    period: "2 weeks",
    deadline: "2026-04-10",
    skills: ["Premiere", "After Effects", "DaVinci"],
    deliverable: "Fine cut master + subtitle version",
  },
];

export const DETAIL_MEMBERS: DetailMember[] = [
  { name: "Shadow Producer", role: "Producer", level: "FD4" },
  { name: "Night Director", role: "Director", level: "FD3" },
  { name: "Galaxy Writer", role: "Screenwriter", level: "FD3" },
  { name: "Pixel Artist", role: "AI Art", level: "FD2" },
  { name: "LightShadow Designer", role: "Scene Design", level: "FD3" },
  { name: "Ghost Producer", role: "Asst. Producer", level: "FD2" },
];

export const DETAIL_ACTIVITIES: { text: string; time: string }[] = [
  { text: "Ghost_Producer joined the studio as Asst. Producer", time: "3 hours ago" },
  { text: "Scene Design phase completed, entering Storyboarding", time: "1 day ago" },
  { text: 'Added "AI Artist" position x 2', time: "2 days ago" },
  { text: "Pixel Artist submitted the first batch of character reference art", time: "3 days ago" },
];

/** Activity feed entries — `textKey` is i18n, `icon` is unicode emoji. */
export const ACTIVITIES = [
  {
    id: 1,
    icon: "👻",
    color: "text-green-400 bg-green-400/10",
    textKey: "activity1" as const,
    timeKey: "timeAgo10m" as const,
  },
  {
    id: 2,
    icon: "📋",
    color: "text-blue-400 bg-blue-400/10",
    textKey: "activity2" as const,
    timeKey: "timeAgo30m" as const,
  },
  {
    id: 3,
    icon: "✅",
    color: "text-cyan-400 bg-cyan-400/10",
    textKey: "activity3" as const,
    timeKey: "timeAgo1h" as const,
  },
  {
    id: 4,
    icon: "📦",
    color: "text-purple-400 bg-purple-400/10",
    textKey: "activity4" as const,
    timeKey: "timeAgo2h" as const,
  },
  {
    id: 5,
    icon: "💬",
    color: "text-amber-400 bg-amber-400/10",
    textKey: "activity5" as const,
    timeKey: "timeAgo3h" as const,
  },
  {
    id: 6,
    icon: "⭐",
    color: "text-yellow-400 bg-yellow-400/10",
    textKey: "activity6" as const,
    timeKey: "timeAgo4h" as const,
  },
  {
    id: 7,
    icon: "🎯",
    color: "text-red-400 bg-red-400/10",
    textKey: "activity7" as const,
    timeKey: "timeAgo5h" as const,
  },
  {
    id: 8,
    icon: "🔔",
    color: "text-orange-400 bg-orange-400/10",
    textKey: "activity8" as const,
    timeKey: "timeAgo6h" as const,
  },
];
