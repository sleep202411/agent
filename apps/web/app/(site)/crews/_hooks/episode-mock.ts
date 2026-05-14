/**
 * Crew episode-management mock store.
 *
 * The crew-episode feature is the "internal production protocol" layer
 * — admin assigns members to episodes, members submit work, admin
 * approves/rejects, finance attaches revenue. Backend doesn't have
 * these endpoints yet, so this module is the source of truth in the
 * meantime. Hooks in `use-episodes.ts` operate on this store; swap
 * the fetcher bodies to real HTTP later without touching the UI.
 *
 * Pattern: a module-level `Map<crewId, CrewEpisodeState>` lazy-seeded
 * on first read. All mutations return clones so callers can't alias
 * into the store and corrupt it. Reseed on `__resetEpisodeMockForTest`.
 */

// ─── Domain types ─────────────────────────────────────

/** Episode lifecycle status (admin-managed). */
export type EpisodeStatus = "not_started" | "in_production" | "approved";

/** Per-member assignment status within an episode (4-state machine). */
export type AssignmentStatus = "in_progress" | "submitted" | "approved" | "rejected";

/** Activity log event kind. Lower-snake-case to match wire-style enums. */
export type EpisodeActivityType =
  | "episode_created"
  | "member_assigned"
  | "member_unassigned"
  | "submission_made"
  | "submission_approved"
  | "submission_rejected"
  | "revenue_set"
  | "episode_approved";

export interface AssignmentRevenue {
  amount: number;
  currency: string;
  setAt: number;
  setByUserId: number;
}

export interface AssignmentSubmission {
  url?: string;
  note?: string;
  submittedAt: number;
}

export interface AssignmentReviewNote {
  reason: string;
  suggestion?: string;
  rejectedAt: number;
}

export interface EpisodeAssignment {
  id: number;
  episodeId: number;
  crewId: string;
  /** crewMember.userId — joins back to useCrewMembers list. */
  userId: number;
  /** Role for this episode (id from /project/role/list). */
  roleId?: number;
  /** Denormalized role label so a stale render doesn't show "#3". */
  roleName?: string;
  status: AssignmentStatus;
  submission?: AssignmentSubmission;
  reviewNote?: AssignmentReviewNote;
  revenue?: AssignmentRevenue;
  updatedAt: number;
}

export interface Episode {
  id: number;
  crewId: string;
  /** 1-based episode number in this crew. Unique per crew. */
  number: number;
  title?: string;
  description?: string;
  status: EpisodeStatus;
  /** ISO date string ("YYYY-MM-DD") or undefined. */
  deadline?: string;
  approvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface EpisodeActivity {
  id: number;
  episodeId: number;
  crewId: string;
  type: EpisodeActivityType;
  actorUserId: number;
  actorName: string;
  /** Free-form context — varies per type. */
  payload: Record<string, unknown>;
  createdAt: number;
}

// ─── Store ─────────────────────────────────────────────

interface CrewEpisodeState {
  episodes: Episode[];
  assignments: EpisodeAssignment[];
  activity: EpisodeActivity[];
  nextEpisodeId: number;
  nextAssignmentId: number;
  nextActivityId: number;
}

const store = new Map<string, CrewEpisodeState>();

/** Mock finance userIds — until backend has a real role flag, anyone
 *  whose userId is in this set behaves as "finance" for revenue edits.
 *  DevIdentitySwitcher exposes this as a toggle so QA can switch. */
export const MOCK_FINANCE_USER_IDS = new Set<number>([9001]);

// ─── Seeding ───────────────────────────────────────────

function seedFor(crewId: string): CrewEpisodeState {
  const now = Date.now();
  const day = 86_400_000;

  const episodes: Episode[] = [
    {
      id: 1,
      crewId,
      number: 1,
      title: "Pilot",
      description: "Opening episode — establishes the world and core cast.",
      status: "approved",
      deadline: "2026-03-08",
      approvedAt: now - 5 * day,
      createdAt: now - 30 * day,
      updatedAt: now - 5 * day,
    },
    {
      id: 2,
      crewId,
      number: 2,
      title: "Rising Tension",
      description: "Introduces the antagonist; ends on a cliffhanger.",
      status: "approved",
      deadline: "2026-03-22",
      approvedAt: now - 2 * day,
      createdAt: now - 22 * day,
      updatedAt: now - 2 * day,
    },
    {
      id: 3,
      crewId,
      number: 3,
      title: "Crossroads",
      description: "Protagonist faces the first major choice.",
      status: "in_production",
      deadline: "2026-04-05",
      createdAt: now - 14 * day,
      updatedAt: now - 2 * 3_600_000,
    },
    {
      id: 4,
      crewId,
      number: 4,
      title: "",
      description: "",
      status: "not_started",
      deadline: "2026-04-19",
      createdAt: now - 7 * day,
      updatedAt: now - 7 * day,
    },
  ];

  // Assignments seeded so EP3 shows all 4 statuses for screenshots.
  const assignments: EpisodeAssignment[] = [
    // EP1 — fully approved, paid
    {
      id: 1,
      episodeId: 1,
      crewId,
      userId: 23,
      roleId: 1,
      roleName: "Screenwriter",
      status: "approved",
      submission: { submittedAt: now - 6 * day, note: "Draft v2 final" },
      revenue: { amount: 2000, currency: "CNY", setAt: now - 5 * day, setByUserId: 9001 },
      updatedAt: now - 5 * day,
    },
    {
      id: 2,
      episodeId: 1,
      crewId,
      userId: 24,
      roleId: 2,
      roleName: "AI Image",
      status: "approved",
      submission: { submittedAt: now - 6 * day },
      revenue: { amount: 1500, currency: "CNY", setAt: now - 5 * day, setByUserId: 9001 },
      updatedAt: now - 5 * day,
    },
    // EP3 — in production, mixed states
    {
      id: 3,
      episodeId: 3,
      crewId,
      userId: 23,
      roleId: 1,
      roleName: "Screenwriter",
      status: "approved",
      submission: { submittedAt: now - 1 * day },
      revenue: { amount: 2200, currency: "CNY", setAt: now - 12 * 3_600_000, setByUserId: 9001 },
      updatedAt: now - 12 * 3_600_000,
    },
    {
      id: 4,
      episodeId: 3,
      crewId,
      userId: 24,
      roleId: 2,
      roleName: "AI Image",
      status: "submitted",
      submission: { submittedAt: now - 2 * 3_600_000, note: "Style v2 for review" },
      updatedAt: now - 2 * 3_600_000,
    },
    {
      id: 5,
      episodeId: 3,
      crewId,
      userId: 25,
      roleId: 3,
      roleName: "Voice",
      status: "in_progress",
      updatedAt: now - 14 * 3_600_000,
    },
    {
      id: 6,
      episodeId: 3,
      crewId,
      userId: 26,
      roleId: 4,
      roleName: "Editor",
      status: "rejected",
      submission: { submittedAt: now - 2 * day },
      reviewNote: {
        reason: "Pacing too slow in scene 4 — feels disjointed from prior cut.",
        suggestion: "Tighten scene 4 by ~30%; reuse the v1 transition on scene 5.",
        rejectedAt: now - 1 * day,
      },
      updatedAt: now - 1 * day,
    },
  ];

  const activity: EpisodeActivity[] = [
    {
      id: 1,
      episodeId: 3,
      crewId,
      type: "submission_made",
      actorUserId: 24,
      actorName: "Li Si",
      payload: { roleName: "AI Image" },
      createdAt: now - 2 * 3_600_000,
    },
    {
      id: 2,
      episodeId: 3,
      crewId,
      type: "submission_rejected",
      actorUserId: 1,
      actorName: "Admin",
      payload: { targetUserId: 26, targetName: "Zhao Liu", roleName: "Editor" },
      createdAt: now - 1 * day,
    },
    {
      id: 3,
      episodeId: 3,
      crewId,
      type: "revenue_set",
      actorUserId: 9001,
      actorName: "Finance",
      payload: { targetUserId: 23, amount: 2200, currency: "CNY" },
      createdAt: now - 12 * 3_600_000,
    },
    {
      id: 4,
      episodeId: 1,
      crewId,
      type: "episode_approved",
      actorUserId: 1,
      actorName: "Admin",
      payload: {},
      createdAt: now - 5 * day,
    },
  ];

  return {
    episodes,
    assignments,
    activity,
    nextEpisodeId: episodes.length + 1,
    nextAssignmentId: assignments.length + 1,
    nextActivityId: activity.length + 1,
  };
}

function getState(crewId: string): CrewEpisodeState {
  let s = store.get(crewId);
  if (!s) {
    s = seedFor(crewId);
    store.set(crewId, s);
  }
  return s;
}

// ─── Cloning helpers ───────────────────────────────────
// Return fresh array references on every read so React Query's
// reference equality picks up changes after mutations.

function cloneEpisodes(crewId: string): Episode[] {
  return getState(crewId).episodes.map((e) => ({ ...e }));
}

function cloneAssignments(crewId: string, episodeId?: number): EpisodeAssignment[] {
  const all = getState(crewId).assignments;
  const filtered = episodeId == null ? all : all.filter((a) => a.episodeId === episodeId);
  return filtered.map((a) => ({
    ...a,
    submission: a.submission ? { ...a.submission } : undefined,
    reviewNote: a.reviewNote ? { ...a.reviewNote } : undefined,
    revenue: a.revenue ? { ...a.revenue } : undefined,
  }));
}

function cloneActivity(crewId: string, episodeId?: number): EpisodeActivity[] {
  const all = getState(crewId).activity;
  const filtered = episodeId == null ? all : all.filter((a) => a.episodeId === episodeId);
  return filtered
    .map((a) => ({ ...a, payload: { ...a.payload } }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Read API ─────────────────────────────────────────

export function listEpisodes(crewId: string): Episode[] {
  return cloneEpisodes(crewId).sort((a, b) => a.number - b.number);
}

export function listAssignments(crewId: string, episodeId: number): EpisodeAssignment[] {
  return cloneAssignments(crewId, episodeId);
}

export function listActivity(crewId: string, episodeId: number): EpisodeActivity[] {
  return cloneActivity(crewId, episodeId);
}

// ─── Mutations ────────────────────────────────────────

interface ActorContext {
  actorUserId: number;
  actorName: string;
}

function logActivity(
  crewId: string,
  episodeId: number,
  type: EpisodeActivityType,
  actor: ActorContext,
  payload: Record<string, unknown> = {}
) {
  const s = getState(crewId);
  s.activity.push({
    id: s.nextActivityId++,
    episodeId,
    crewId,
    type,
    actorUserId: actor.actorUserId,
    actorName: actor.actorName,
    payload,
    createdAt: Date.now(),
  });
}

export interface CreateEpisodeInput {
  crewId: string;
  title?: string;
  description?: string;
  deadline?: string;
}

export function createEpisode(input: CreateEpisodeInput, actor: ActorContext): Episode {
  const s = getState(input.crewId);
  const number = s.episodes.length === 0 ? 1 : Math.max(...s.episodes.map((e) => e.number)) + 1;
  const now = Date.now();
  const ep: Episode = {
    id: s.nextEpisodeId++,
    crewId: input.crewId,
    number,
    title: input.title?.trim() || undefined,
    description: input.description?.trim() || undefined,
    status: "not_started",
    deadline: input.deadline,
    createdAt: now,
    updatedAt: now,
  };
  s.episodes.push(ep);
  logActivity(input.crewId, ep.id, "episode_created", actor, { number });
  return { ...ep };
}

export function approveEpisode(crewId: string, episodeId: number, actor: ActorContext): Episode {
  const s = getState(crewId);
  const ep = s.episodes.find((e) => e.id === episodeId);
  if (!ep) throw new Error(`Episode not found: ${episodeId}`);
  const now = Date.now();
  ep.status = "approved";
  ep.approvedAt = now;
  ep.updatedAt = now;
  logActivity(crewId, episodeId, "episode_approved", actor);
  return { ...ep };
}

export interface AssignMemberInput {
  crewId: string;
  episodeId: number;
  userId: number;
  roleId?: number;
  roleName?: string;
}

export function assignMember(input: AssignMemberInput, actor: ActorContext): EpisodeAssignment {
  const s = getState(input.crewId);
  const dup = s.assignments.find(
    (a) => a.episodeId === input.episodeId && a.userId === input.userId
  );
  if (dup) throw new Error("Member already assigned to this episode");
  const now = Date.now();
  const ep = s.episodes.find((e) => e.id === input.episodeId);
  if (ep && ep.status === "not_started") {
    ep.status = "in_production";
    ep.updatedAt = now;
  }
  const a: EpisodeAssignment = {
    id: s.nextAssignmentId++,
    episodeId: input.episodeId,
    crewId: input.crewId,
    userId: input.userId,
    roleId: input.roleId,
    roleName: input.roleName,
    status: "in_progress",
    updatedAt: now,
  };
  s.assignments.push(a);
  logActivity(input.crewId, input.episodeId, "member_assigned", actor, {
    targetUserId: input.userId,
    roleName: input.roleName,
  });
  return { ...a };
}

export function unassignMember(crewId: string, assignmentId: number, actor: ActorContext): void {
  const s = getState(crewId);
  const idx = s.assignments.findIndex((a) => a.id === assignmentId);
  if (idx === -1) return;
  const removed = s.assignments[idx];
  s.assignments.splice(idx, 1);
  logActivity(crewId, removed.episodeId, "member_unassigned", actor, {
    targetUserId: removed.userId,
    roleName: removed.roleName,
  });
}

export function submitAssignment(
  crewId: string,
  assignmentId: number,
  payload: { note?: string; url?: string },
  actor: ActorContext
): EpisodeAssignment {
  const s = getState(crewId);
  const a = s.assignments.find((x) => x.id === assignmentId);
  if (!a) throw new Error(`Assignment not found: ${assignmentId}`);
  const now = Date.now();
  a.status = "submitted";
  a.submission = { submittedAt: now, note: payload.note, url: payload.url };
  a.reviewNote = undefined;
  a.updatedAt = now;
  logActivity(crewId, a.episodeId, "submission_made", actor, {
    targetUserId: a.userId,
    roleName: a.roleName,
  });
  return { ...a };
}

export function approveAssignment(
  crewId: string,
  assignmentId: number,
  actor: ActorContext
): EpisodeAssignment {
  const s = getState(crewId);
  const a = s.assignments.find((x) => x.id === assignmentId);
  if (!a) throw new Error(`Assignment not found: ${assignmentId}`);
  const now = Date.now();
  a.status = "approved";
  a.reviewNote = undefined;
  a.updatedAt = now;
  logActivity(crewId, a.episodeId, "submission_approved", actor, {
    targetUserId: a.userId,
    roleName: a.roleName,
  });
  return { ...a };
}

export function rejectAssignment(
  crewId: string,
  assignmentId: number,
  payload: { reason: string; suggestion?: string },
  actor: ActorContext
): EpisodeAssignment {
  const s = getState(crewId);
  const a = s.assignments.find((x) => x.id === assignmentId);
  if (!a) throw new Error(`Assignment not found: ${assignmentId}`);
  const now = Date.now();
  a.status = "rejected";
  a.reviewNote = { reason: payload.reason, suggestion: payload.suggestion, rejectedAt: now };
  a.updatedAt = now;
  logActivity(crewId, a.episodeId, "submission_rejected", actor, {
    targetUserId: a.userId,
    roleName: a.roleName,
    reason: payload.reason,
  });
  return { ...a };
}

export function setAssignmentRevenue(
  crewId: string,
  assignmentId: number,
  payload: { amount: number; currency?: string },
  actor: ActorContext
): EpisodeAssignment {
  const s = getState(crewId);
  const a = s.assignments.find((x) => x.id === assignmentId);
  if (!a) throw new Error(`Assignment not found: ${assignmentId}`);
  const now = Date.now();
  a.revenue = {
    amount: payload.amount,
    currency: payload.currency ?? "CNY",
    setAt: now,
    setByUserId: actor.actorUserId,
  };
  a.updatedAt = now;
  logActivity(crewId, a.episodeId, "revenue_set", actor, {
    targetUserId: a.userId,
    amount: payload.amount,
    currency: payload.currency ?? "CNY",
  });
  return { ...a };
}

// ─── Test-only ────────────────────────────────────────

export function __resetEpisodeMockForTest(crewId?: string): void {
  if (crewId) store.delete(crewId);
  else store.clear();
}
