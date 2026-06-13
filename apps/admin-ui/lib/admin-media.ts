import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";

export type AdminMediaLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export type AdminMediaOverview = {
  totalAssets: number;
  blockedAssets: number;
  purgingPlacements: number;
  pendingPurgeActions: number;
  deadPurgeActions: number;
  activeProcessingJobs: number;
  deadProcessingJobs: number;
};

export type AdminMediaPlacement = {
  id: string;
  role: string;
  status: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  publicBaseUrl: string | null;
  cdnProvider: string | null;
  cdnCacheKey: string | null;
  priority: number;
  purgedAt: string | null;
  updatedAt: string;
};

export type AdminMediaModerationStatus = "approved" | "blocked" | "flagged" | "unreviewed";

export type AdminMediaAsset = {
  id: string;
  kind: string;
  source: string;
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  sizeBytes: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  visibility: string;
  status: string;
  moderationStatus: AdminMediaModerationStatus;
  moderationReason: string | null;
  createdByUserId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
  variants: Array<{
    id: string;
    variantKey: string;
    kind: string;
    status: string;
    contentType: string;
    placements: AdminMediaPlacement[];
  }>;
  placements: AdminMediaPlacement[];
  usages: Array<{
    id: string;
    surface: string;
    sourceSurface: string | null;
    role: string;
    userId: string | null;
    workspaceId: string | null;
    projectId: string | null;
    aiJobId: string | null;
    lastObservedAt: string;
  }>;
  moderationCases: Array<{
    id: string;
    status: string;
    severity: string;
    reasonCode: string;
    reason: string | null;
    openedAt: string;
    resolvedAt: string | null;
  }>;
  moderationActions: Array<{
    id: string;
    actionType: string;
    status: string;
    provider: string | null;
    attempt: number;
    errorMessage: string | null;
    deadAt: string | null;
    createdAt: string;
  }>;
  processingJobs: Array<{
    id: string;
    jobType: string;
    status: string;
    attempt: number;
    errorMessage: string | null;
    deadAt: string | null;
    createdAt: string;
  }>;
};

export type AdminMediaModerationAction = {
  id: string;
  assetId: string;
  variantId: string | null;
  placementId: string | null;
  actionType: string;
  status: string;
  reason: string | null;
  actorAdminId: string | null;
  provider: string | null;
  providerTaskId: string | null;
  errorMessage: string | null;
  attempt: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  deadAt: string | null;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
  asset: {
    id: string;
    kind: string;
    source: string;
    moderationStatus: string;
    createdByUserId: string | null;
    createdAt: string;
  } | null;
  placement: AdminMediaPlacement | null;
  case: {
    id: string;
    status: string;
    severity: string;
    reasonCode: string;
    reason: string | null;
  } | null;
};

export type AdminMediaProcessingJob = {
  id: string;
  assetId: string;
  sourceVariantId: string | null;
  jobType: string;
  status: string;
  priority: number;
  attempt: number;
  maxAttempts: number;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  nextAttemptAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  deadAt: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
  asset: {
    id: string;
    kind: string;
    source: string;
    status: string;
    moderationStatus: string;
    createdAt: string;
  } | null;
  sourceVariant: {
    id: string;
    variantKey: string;
    kind: string;
    status: string;
  } | null;
};

export type AdminMediaInitialData = {
  overview: AdminMediaOverview | null;
  assets: { items: AdminMediaAsset[] } | null;
  moderationActions: { items: AdminMediaModerationAction[] } | null;
  processingJobs: { items: AdminMediaProcessingJob[] } | null;
  error: string | null;
};

export type AdminMediaView = "assets" | "moderation" | "overview" | "processing";

const EMPTY_MEDIA_DATA: AdminMediaInitialData = {
  overview: null,
  assets: null,
  moderationActions: null,
  processingJobs: null,
  error: null,
};

export async function fetchAdminMediaInitial(
  view: AdminMediaView = "overview"
): Promise<AdminMediaInitialData> {
  if (view === "overview") {
    const [overview, assets, moderationActions, processingJobs] = await Promise.all([
      fetchAdminMediaResource<AdminMediaOverview>("/media/overview", "媒体资产总览加载失败。"),
      fetchAdminMediaResource<{ items: AdminMediaAsset[] }>(
        "/media/assets?limit=12",
        "媒体资产加载失败。"
      ),
      fetchAdminMediaResource<{ items: AdminMediaModerationAction[] }>(
        "/media/moderation-actions?actionType=purge_cdn&limit=12",
        "CDN Purge 队列加载失败。"
      ),
      fetchAdminMediaResource<{ items: AdminMediaProcessingJob[] }>(
        "/media/processing-jobs?limit=12",
        "媒体处理任务加载失败。"
      ),
    ]);
    return {
      overview: overview.data,
      assets: assets.data,
      moderationActions: moderationActions.data,
      processingJobs: processingJobs.data,
      error: overview.error ?? assets.error ?? moderationActions.error ?? processingJobs.error,
    };
  }

  if (view === "assets") {
    const assets = await fetchAdminMediaResource<{ items: AdminMediaAsset[] }>(
      "/media/assets?limit=80",
      "媒体资产加载失败。"
    );
    return { ...EMPTY_MEDIA_DATA, assets: assets.data, error: assets.error };
  }

  if (view === "moderation") {
    const moderationActions = await fetchAdminMediaResource<{
      items: AdminMediaModerationAction[];
    }>("/media/moderation-actions?actionType=purge_cdn&limit=80", "CDN Purge 队列加载失败。");
    return {
      ...EMPTY_MEDIA_DATA,
      moderationActions: moderationActions.data,
      error: moderationActions.error,
    };
  }

  const processingJobs = await fetchAdminMediaResource<{ items: AdminMediaProcessingJob[] }>(
    "/media/processing-jobs?limit=80",
    "媒体处理任务加载失败。"
  );
  return {
    ...EMPTY_MEDIA_DATA,
    processingJobs: processingJobs.data,
    error: processingJobs.error,
  };
}

async function fetchAdminMediaResource<T>(
  path: string,
  fallbackMessage: string
): Promise<AdminMediaLoadResult<T>> {
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
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error && err.message ? err.message : fallbackMessage,
    };
  }
}
