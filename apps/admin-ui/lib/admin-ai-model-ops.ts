import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { currentAdminSite } from "@/lib/admin-sites";

export type AdminAiLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export type AdminAiProviderAccount = {
  id: string;
  provider: string;
  status: "draft" | "active" | "disabled" | "degraded" | "archived";
  rateLimitPolicy: unknown;
  quotaPolicy: unknown;
  createdAt: string;
  updatedAt: string;
  endpointCount: number;
  bindingCount: number;
};

export type AdminAiProviderEndpoint = {
  id: string;
  providerAccountId: string;
  provider: string;
  endpointId: string;
  displayName: string | null;
  modality: "image" | "video";
  status: "draft" | "active" | "disabled" | "degraded" | "archived";
  healthStatus: "unknown" | "healthy" | "degraded" | "outage";
  supportedModes: unknown;
  capabilities: unknown;
  providerInputSchema: unknown;
  providerOutputSchema: unknown;
  providerPricing: unknown;
  providerQuotaPolicy: unknown;
  catalogSnapshot: unknown;
  documentation: unknown;
  disabledReason: string | null;
  updatedAt: string;
  providerAccount?: {
    id: string;
    provider: string;
  };
  bindingCount: number;
};

export type AdminAiCanonicalModel = {
  id: string;
  slug: string;
  displayName: string;
  modality: "image" | "video";
  family: string;
  generationModes: unknown;
  visibility: "hidden" | "direct";
  status: "draft" | "active" | "disabled" | "degraded" | "archived";
  description: string | null;
  parameterPolicy: unknown;
  outputPolicy: unknown;
  entitlementPolicy: unknown;
  billingPolicy: unknown;
  queuePolicy: unknown;
  uiPolicy: unknown;
  observabilityPolicy: unknown;
  metadata: unknown;
  updatedAt: string;
  bindingCount: number;
  jobCount: number;
};

export type AdminAiProviderBinding = {
  id: string;
  provider: string;
  endpointId: string;
  displayName: string | null;
  modality: "image" | "video";
  status: "draft" | "active" | "disabled" | "degraded" | "archived";
  priority: number;
  weight: number;
  supportedModes: unknown;
  inputSchema: unknown;
  outputSchema: unknown;
  parameterMap: unknown;
  pricingPolicy: unknown;
  providerPricing: unknown;
  queuePolicy: unknown;
  routingPolicy: unknown;
  fallbackPolicy: unknown;
  observabilityPolicy: unknown;
  catalogSnapshot: unknown;
  documentation: unknown;
  disabledReason: string | null;
  updatedAt: string;
  providerAccount?: {
    id: string;
    provider: string;
  };
  providerEndpoint: {
    id: string;
    endpointId: string;
    status: string;
    healthStatus: string;
  };
  canonicalModel: {
    id: string;
    slug: string;
    displayName: string;
  };
  jobCount: number;
};

export type AdminAiJobListItem = {
  id: string;
  provider: string;
  modelId: string;
  providerJobId: string | null;
  status: string;
  stage: string;
  userId: string;
  prompt: string;
  createdAt: string;
  completedAt: string | null;
  cost: unknown;
  metrics: unknown;
  error: unknown;
  canonicalModel: { id: string; slug: string; displayName: string } | null;
  providerBinding: { id: string; endpointId: string; status: string } | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    providerRequestId: string | null;
    providerStatus: number | null;
    runDurationMs: number | null;
    completedAt: string | null;
  }>;
  outputs: Array<{ id: string; type: string; url: string; outputIndex: number }>;
};

export type AdminAiOverviewData = {
  metrics: {
    providerAccounts: number;
    providerEndpoints: number;
    canonicalModels: number;
    providerBindings: number;
    queuedJobs: number;
    runningJobs: number;
    failedJobs24h: number;
    unprocessedEvents: number;
    deadOutboxEvents: number;
  };
  cost24h: {
    byCurrency: Array<{ currency: string; amount: number }>;
    providerCostUsd: number;
    marginUsd: number;
  };
  recentJobs: Array<{
    id: string;
    provider: string;
    modelId: string;
    providerJobId: string | null;
    status: string;
    stage: string;
    userId: string;
    createdAt: string;
    completedAt: string | null;
    canonicalModel: { id: string; slug: string; displayName: string } | null;
    providerBinding: { id: string; endpointId: string; status: string } | null;
  }>;
};

export type AdminAiProviderListData = { items: AdminAiProviderAccount[] };
export type AdminAiEndpointListData = { items: AdminAiProviderEndpoint[] };
export type AdminAiModelListData = { items: AdminAiCanonicalModel[] };
export type AdminAiBindingListData = { items: AdminAiProviderBinding[] };
export type AdminAiJobListData = { items: AdminAiJobListItem[] };

export type AdminAiModelOpsView = "overview" | "providers" | "endpoints" | "models" | "jobs";

export type AdminAiModelOpsInitialData = {
  overview: AdminAiOverviewData | null;
  providers: AdminAiProviderListData | null;
  endpoints: AdminAiEndpointListData | null;
  models: AdminAiModelListData | null;
  bindings: AdminAiBindingListData | null;
  jobs: AdminAiJobListData | null;
  error: string | null;
};

export async function fetchAdminAiModelOpsInitial(): Promise<AdminAiModelOpsInitialData> {
  const [overview, providers, endpoints, models, bindings, jobs] = await Promise.all([
    fetchAdminAiResource<AdminAiOverviewData>("/ai-model-ops/overview", "AI 模型总览加载失败。"),
    fetchAdminAiResource<AdminAiProviderListData>(
      "/ai-model-ops/providers",
      "供应商账号加载失败。"
    ),
    fetchAdminAiResource<AdminAiEndpointListData>(
      "/ai-model-ops/endpoints?modality=image",
      "供应商端点加载失败。"
    ),
    fetchAdminAiResource<AdminAiModelListData>(
      "/ai-model-ops/models?modality=image",
      "统一模型加载失败。"
    ),
    fetchAdminAiResource<AdminAiBindingListData>(
      "/ai-model-ops/bindings?modality=image",
      "供应商绑定加载失败。"
    ),
    fetchAdminAiResource<AdminAiJobListData>("/ai-model-ops/jobs", "AI 任务加载失败。"),
  ]);
  return {
    overview: overview.data,
    providers: providers.data,
    endpoints: endpoints.data,
    models: models.data,
    bindings: bindings.data,
    jobs: jobs.data,
    error:
      overview.error ??
      providers.error ??
      endpoints.error ??
      models.error ??
      bindings.error ??
      jobs.error ??
      null,
  };
}

export async function fetchAdminAiModelOpsView(
  view: AdminAiModelOpsView
): Promise<AdminAiModelOpsInitialData> {
  const empty = emptyAdminAiModelOpsInitialData();

  if (view === "overview") {
    const [overview, providers, endpoints, models, bindings, jobs] = await Promise.all([
      fetchAdminAiResource<AdminAiOverviewData>("/ai-model-ops/overview", "AI 模型总览加载失败。"),
      fetchAdminAiResource<AdminAiProviderListData>(
        "/ai-model-ops/providers",
        "供应商账号加载失败。"
      ),
      fetchAdminAiResource<AdminAiEndpointListData>(
        "/ai-model-ops/endpoints?modality=image",
        "供应商端点加载失败。"
      ),
      fetchAdminAiResource<AdminAiModelListData>(
        "/ai-model-ops/models?modality=image",
        "统一模型加载失败。"
      ),
      fetchAdminAiResource<AdminAiBindingListData>(
        "/ai-model-ops/bindings?modality=image",
        "供应商绑定加载失败。"
      ),
      fetchAdminAiResource<AdminAiJobListData>("/ai-model-ops/jobs", "AI 任务加载失败。"),
    ]);
    return {
      overview: overview.data,
      providers: providers.data,
      endpoints: endpoints.data,
      models: models.data,
      bindings: bindings.data,
      jobs: jobs.data,
      error:
        overview.error ??
        providers.error ??
        endpoints.error ??
        models.error ??
        bindings.error ??
        jobs.error ??
        null,
    };
  }

  if (view === "providers") {
    const [providers, endpoints] = await Promise.all([
      fetchAdminAiResource<AdminAiProviderListData>(
        "/ai-model-ops/providers",
        "供应商账号加载失败。"
      ),
      fetchAdminAiResource<AdminAiEndpointListData>(
        "/ai-model-ops/endpoints?modality=image",
        "供应商端点加载失败。"
      ),
    ]);
    return {
      ...empty,
      providers: providers.data,
      endpoints: endpoints.data,
      error: providers.error ?? endpoints.error,
    };
  }

  if (view === "endpoints") {
    const [endpoints, providers, models] = await Promise.all([
      fetchAdminAiResource<AdminAiEndpointListData>(
        "/ai-model-ops/endpoints?modality=image",
        "供应商端点加载失败。"
      ),
      fetchAdminAiResource<AdminAiProviderListData>(
        "/ai-model-ops/providers",
        "供应商账号加载失败。"
      ),
      fetchAdminAiResource<AdminAiModelListData>(
        "/ai-model-ops/models?modality=image",
        "统一模型加载失败。"
      ),
    ]);
    return {
      ...empty,
      endpoints: endpoints.data,
      providers: providers.data,
      models: models.data,
      error: endpoints.error ?? providers.error ?? models.error,
    };
  }

  if (view === "models") {
    const [models, bindings, endpoints] = await Promise.all([
      fetchAdminAiResource<AdminAiModelListData>(
        "/ai-model-ops/models?modality=image",
        "统一模型加载失败。"
      ),
      fetchAdminAiResource<AdminAiBindingListData>(
        "/ai-model-ops/bindings?modality=image",
        "供应商绑定加载失败。"
      ),
      fetchAdminAiResource<AdminAiEndpointListData>(
        "/ai-model-ops/endpoints?modality=image",
        "供应商端点加载失败。"
      ),
    ]);
    return {
      ...empty,
      models: models.data,
      bindings: bindings.data,
      endpoints: endpoints.data,
      error: models.error ?? bindings.error ?? endpoints.error,
    };
  }

  const jobs = await fetchAdminAiResource<AdminAiJobListData>(
    "/ai-model-ops/jobs",
    "AI 任务加载失败。"
  );
  return { ...empty, jobs: jobs.data, error: jobs.error };
}

function emptyAdminAiModelOpsInitialData(): AdminAiModelOpsInitialData {
  return {
    overview: null,
    providers: null,
    endpoints: null,
    models: null,
    bindings: null,
    jobs: null,
    error: null,
  };
}

async function fetchAdminAiResource<T>(
  path: string,
  fallbackMessage: string
): Promise<AdminAiLoadResult<T>> {
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
