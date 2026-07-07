import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { currentAdminSite } from "@/lib/admin-sites";

export type AgentUserStatus = "active" | "paused" | "disabled";
export type AgentUserIdentityStatus = "shadow" | "bound";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AgentActionStatus = "planned" | "running" | "succeeded" | "failed" | "skipped";
export type AgentMemoryType =
  | "preference"
  | "content_affinity"
  | "negative_signal"
  | "relationship"
  | "summary"
  | "fact";
export type AgentMemoryStatus = "active" | "archived";

export type AgentPersona = {
  personality?: string;
  interests?: string[];
  communicationStyle?: string;
  decisionBias?: string;
  [key: string]: unknown;
};

export type AgentSchedule = {
  mode?: "scheduled" | "manual";
  activeDays?: number[];
  activeWindow?: {
    start?: string;
    end?: string;
  };
  jitterMinutes?: number;
  dailyActionBudget?: number;
  hourlyActionBudget?: number;
  [key: string]: unknown;
};

export type AgentPolicy = {
  capabilities?: {
    viewIp?: boolean;
    likeIp?: boolean;
    collectIp?: boolean;
    comment?: boolean;
    createContent?: boolean;
  };
  limits?: {
    viewsPerDay?: number;
    likesPerDay?: number;
    commentsPerDay?: number;
    creationsPerDay?: number;
  };
  safety?: {
    requireHumanApprovalForCreation?: boolean;
  };
  [key: string]: unknown;
};

export type AdminAgentRun = {
  id: string;
  agentUserId: string;
  status: AgentRunStatus;
  trigger: string;
  objective: string | null;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metrics: Record<string, unknown>;
  metadata: Record<string, unknown>;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  actionCount?: number;
};

export type AdminAgentAction = {
  id: string;
  agentUserId: string;
  runId: string | null;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  status: AgentActionStatus;
  idempotencyKey: string | null;
  decision: Record<string, unknown>;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  metadata: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  plannedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminAgentMemory = {
  id: string;
  agentUserId: string;
  memoryKey: string | null;
  type: AgentMemoryType;
  status: AgentMemoryStatus;
  scopeType: string | null;
  scopeId: string | null;
  summary: string;
  content: Record<string, unknown>;
  confidence: number;
  weight: number;
  sourceActionIds: string[];
  lastReinforcedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AdminAgentUser = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  status: AgentUserStatus;
  identityStatus: AgentUserIdentityStatus;
  platformUserId: string | null;
  simulatedEmail: string | null;
  locale: string;
  region: string | null;
  timezone: string;
  persona: AgentPersona;
  schedule: AgentSchedule;
  policy: AgentPolicy;
  notes: string | null;
  createdByAdminId: string | null;
  updatedByAdminId: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  runCount: number;
  actionCount: number;
  memoryCount: number;
  latestRun: AdminAgentRun | null;
  recentRuns?: AdminAgentRun[];
  recentActions?: AdminAgentAction[];
  recentMemories?: AdminAgentMemory[];
};

export type AdminAgentUserListData = {
  items: AdminAgentUser[];
  page: number;
  pageSize: number;
  total: number;
  stats: {
    activeCount: number;
    pausedCount: number;
    disabledCount: number;
    shadowCount: number;
    boundCount: number;
  };
};

export type AdminAgentUsersInitialData = {
  list: AdminAgentUserListData | null;
  error: string | null;
};

export async function loadAdminAgentUsers(): Promise<AdminAgentUsersInitialData> {
  const result = await fetchAdminAgentResource<AdminAgentUserListData>(
    "/agent-users?page=1&pageSize=50",
    "Agent 用户加载失败。"
  );
  return { list: result.data, error: result.error };
}

async function fetchAdminAgentResource<T>(
  path: string,
  fallbackMessage: string
): Promise<{ data: T | null; error: string | null }> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const headers = adminAuthHeaders(sessionToken);
  if (!headers) return { data: null, error: "后台登录已失效，请重新登录。" };

  try {
    const response = await fetch(adminApiUrl(path), {
      headers,
      cache: "no-store",
    });
    return { data: await parseAdminEnvelope<T>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error ? error.message : `${currentAdminSite().label} ${fallbackMessage}`,
    };
  }
}
