"use client";

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleOff,
  IconDatabaseSearch,
  IconEdit,
  IconFileSearch,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import { AI_PROVIDER_LABELS } from "@repo/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminFormField as FormField,
  type AdminFieldDefinition,
} from "@/components/admin/form-field";
import { cn } from "@/lib/utils";
import {
  type AdminAiBindingListData,
  type AdminAiCanonicalModel,
  type AdminAiEndpointListData,
  type AdminAiJobDetail,
  type AdminAiJobListData,
  type AdminAiJobListItem,
  type AdminAiModelListData,
  type AdminAiModelOpsInitialData,
  type AdminAiModelOpsView,
  type AdminAiOverviewData,
  type AdminAiProviderAccount,
  type AdminAiProviderBinding,
  type AdminAiProviderEndpoint,
  type AdminAiProviderListData,
} from "@/lib/admin-ai-model-ops";
import {
  ErrorBanner,
  Metric,
  StatusPill,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import { PageHeader } from "@/components/admin/page-header";

type StatusFilter = "" | "draft" | "active" | "disabled" | "degraded" | "archived";
type DrawerMode = "provider" | "endpoint" | "model" | "binding" | "endpointBinding" | "job" | null;
type JsonObject = Record<string, unknown>;

const COMPUTE_POINT_USD = 0.01;

const EMPTY_PROVIDERS: AdminAiProviderListData = { items: [] };
const EMPTY_ENDPOINTS: AdminAiEndpointListData = { items: [] };
const EMPTY_MODELS: AdminAiModelListData = { items: [] };
const EMPTY_BINDINGS: AdminAiBindingListData = { items: [] };
const EMPTY_JOBS: AdminAiJobListData = { items: [] };
const AI_MODEL_DRAWER_GUTTER = "calc(100vw - 64px)";
const AI_MODEL_POLICY_DRAWER_STYLE = {
  width: `min(1480px, ${AI_MODEL_DRAWER_GUTTER})`,
  maxWidth: `min(1480px, ${AI_MODEL_DRAWER_GUTTER})`,
} satisfies CSSProperties;
const AI_PROVIDER_ACCOUNT_DRAWER_STYLE = {
  width: `min(1040px, ${AI_MODEL_DRAWER_GUTTER})`,
  maxWidth: `min(1040px, ${AI_MODEL_DRAWER_GUTTER})`,
} satisfies CSSProperties;
const AI_PROVIDER_BINDING_DRAWER_STYLE = {
  width: `min(1080px, ${AI_MODEL_DRAWER_GUTTER})`,
  maxWidth: `min(1080px, ${AI_MODEL_DRAWER_GUTTER})`,
} satisfies CSSProperties;
const AI_PROVIDER_ENDPOINT_DRAWER_STYLE = {
  width: `min(1480px, ${AI_MODEL_DRAWER_GUTTER})`,
  maxWidth: `min(1480px, ${AI_MODEL_DRAWER_GUTTER})`,
} satisfies CSSProperties;
const AI_JOB_DETAIL_DRAWER_STYLE = {
  width: `min(1120px, ${AI_MODEL_DRAWER_GUTTER})`,
  maxWidth: `min(1120px, ${AI_MODEL_DRAWER_GUTTER})`,
} satisfies CSSProperties;
const AI_MODEL_SHEET_CLASSNAME =
  "w-full !max-w-none gap-0 overflow-hidden bg-white p-0 sm:!max-w-none";

const VIEW_META: Record<
  AdminAiModelOpsView,
  {
    title: string;
    description: string;
    icon: ReactNode;
    primaryAction?: "new-endpoint" | "new-model";
  }
> = {
  overview: {
    title: "模型运营总览",
    description: "监控 provider、统一模型、路由、队列、成本和 request 证据的整体健康。",
    icon: <IconRoute className="size-5" />,
  },
  providers: {
    title: "供应商账号",
    description:
      "管理 provider 账号的状态与限流 / 配额策略；账号由代码侧 seed 维护，密钥从环境变量读取。",
    icon: <IconShieldCheck className="size-5" />,
  },
  endpoints: {
    title: "供应商端点",
    description: "手动维护 Fal、百炼、OpenAI 等真实 endpoint；这里不生成用户侧模型。",
    icon: <IconDatabaseSearch className="size-5" />,
    primaryAction: "new-endpoint",
  },
  models: {
    title: "统一模型",
    description:
      "人工维护用户侧展示的模型身份，再在模型详情里显式绑定一个或多个 provider endpoint。",
    icon: <IconDatabaseSearch className="size-5" />,
    primaryAction: "new-model",
  },
  jobs: {
    title: "请求任务",
    description: "查看每一次生成 request 的输入、输出、attempt、timing、成本和 provider 证据。",
    icon: <IconFileSearch className="size-5" />,
  },
};

const PROVIDER_ACCOUNT_FIELDS = {
  provider: { name: "provider", label: "Provider", required: true },
  status: { name: "status", label: "状态", required: true },
  rateLimitPolicy: { name: "rateLimitPolicy", label: "限流策略 JSON" },
  quotaPolicy: { name: "quotaPolicy", label: "配额 / 花费策略 JSON" },
} satisfies Record<string, AdminFieldDefinition>;

const MODEL_POLICY_FIELDS = {
  slug: { name: "slug", label: "Slug", required: true },
  modality: { name: "modality", label: "类型", required: true },
  displayName: { name: "displayName", label: "显示名称", required: true },
  family: { name: "family", label: "Family", required: true },
  status: { name: "status", label: "状态", required: true },
  description: { name: "description", label: "描述" },
  generationModes: { name: "generationModes", label: "生成模式 JSON Array" },
  parameterPolicy: { name: "parameterPolicy", label: "参数策略 JSON" },
  billingPolicy: { name: "billingPolicy", label: "积分策略 JSON" },
  queuePolicy: { name: "queuePolicy", label: "队列策略 JSON" },
  entitlementPolicy: { name: "entitlementPolicy", label: "权益策略 JSON" },
  observabilityPolicy: { name: "observabilityPolicy", label: "观测策略 JSON" },
  uiPolicy: { name: "uiPolicy", label: "前台 UI 策略 JSON" },
  metadata: { name: "metadata", label: "Metadata JSON" },
} satisfies Record<string, AdminFieldDefinition>;

const PROVIDER_ENDPOINT_FIELDS = {
  providerAccountId: { name: "providerAccountId", label: "供应商账号", required: true },
  endpointId: { name: "endpointId", label: "Endpoint ID", required: true },
  displayName: { name: "displayName", label: "显示名称", required: true },
  modality: { name: "modality", label: "类型", required: true },
  status: { name: "status", label: "状态", required: true },
  healthStatus: { name: "healthStatus", label: "健康状态", required: true },
  disabledReason: { name: "disabledReason", label: "停用原因" },
  supportedModes: { name: "supportedModes", label: "支持模式" },
  providerInputSchema: { name: "providerInputSchema", label: "Provider input schema JSON" },
  providerOutputSchema: { name: "providerOutputSchema", label: "Provider output schema JSON" },
  maxConcurrentRequests: { name: "maxConcurrentRequests", label: "最大并发" },
  maxRequestsPerMinute: { name: "maxRequestsPerMinute", label: "每分钟请求上限" },
  requestTimeoutSeconds: { name: "requestTimeoutSeconds", label: "请求超时秒数" },
  cooldownSeconds: { name: "cooldownSeconds", label: "熔断冷却秒数" },
  failureThreshold: { name: "failureThreshold", label: "失败熔断阈值" },
  catalogSnapshot: { name: "catalogSnapshot", label: "Catalog snapshot JSON" },
} satisfies Record<string, AdminFieldDefinition>;

const PROVIDER_MODE_OPTIONS = [
  { value: "text_to_image", label: "Text to image" },
  { value: "image_to_image", label: "Image to image" },
  { value: "inpainting", label: "Inpainting" },
  { value: "text_to_video", label: "Text to video" },
  { value: "image_to_video", label: "Image to video" },
] as const;

const PROVIDER_BINDING_FIELDS = {
  canonicalModelId: { name: "canonicalModelId", label: "统一模型", required: true },
  providerEndpointId: { name: "providerEndpointId", label: "供应商端点", required: true },
  status: { name: "status", label: "状态", required: true },
  priority: { name: "priority", label: "路由优先级" },
  weight: { name: "weight", label: "权重" },
  disabledReason: { name: "disabledReason", label: "停用原因" },
} satisfies Record<string, AdminFieldDefinition>;

export function AiModelOpsPanel({
  view,
  siteLabel,
  databaseLabel,
  initialData,
}: {
  view: AdminAiModelOpsView;
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminAiModelOpsInitialData;
}) {
  const meta = VIEW_META[view];
  const [overview, setOverview] = useState<AdminAiOverviewData | null>(initialData.overview);
  const [providers, setProviders] = useState<AdminAiProviderListData>(
    initialData.providers ?? EMPTY_PROVIDERS
  );
  const [endpoints, setEndpoints] = useState<AdminAiEndpointListData>(
    initialData.endpoints ?? EMPTY_ENDPOINTS
  );
  const [models, setModels] = useState<AdminAiModelListData>(initialData.models ?? EMPTY_MODELS);
  const [bindings, setBindings] = useState<AdminAiBindingListData>(
    initialData.bindings ?? EMPTY_BINDINGS
  );
  const [jobs, setJobs] = useState<AdminAiJobListData>(initialData.jobs ?? EMPTY_JOBS);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialData.error);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [selectedProvider, setSelectedProvider] = useState<AdminAiProviderAccount | null>(null);
  const [selectedModel, setSelectedModel] = useState<AdminAiCanonicalModel | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<AdminAiProviderEndpoint | null>(null);
  // When set, the create-binding drawer is scoped to this fixed canonical model (pick endpoint only).
  const [bindingModel, setBindingModel] = useState<AdminAiCanonicalModel | null>(null);
  const [selectedBinding, setSelectedBinding] = useState<AdminAiProviderBinding | null>(null);
  const [selectedJob, setSelectedJob] = useState<AdminAiJobListItem | null>(null);
  const [jobDetail, setJobDetail] = useState<AdminAiJobDetail | null>(null);

  async function refresh(nextStatus = statusFilter) {
    setLoading(true);
    setError(null);
    try {
      const bindingQuery = new URLSearchParams({ modality: "image" });
      if (nextStatus) bindingQuery.set("status", nextStatus);
      const endpointQuery = new URLSearchParams({ modality: "image" });
      if (nextStatus) endpointQuery.set("status", nextStatus);

      if (view === "overview") {
        const [nextOverview, nextProviders, nextEndpoints, nextModels, nextBindings, nextJobs] =
          await Promise.all([
            requestEnvelope<AdminAiOverviewData>("/api/admin/ai-model-ops/overview"),
            requestEnvelope<AdminAiProviderListData>("/api/admin/ai-model-ops/providers"),
            requestEnvelope<AdminAiEndpointListData>(
              `/api/admin/ai-model-ops/endpoints?${endpointQuery.toString()}`
            ),
            requestEnvelope<AdminAiModelListData>("/api/admin/ai-model-ops/models?modality=image"),
            requestEnvelope<AdminAiBindingListData>(
              `/api/admin/ai-model-ops/bindings?${bindingQuery.toString()}`
            ),
            requestEnvelope<AdminAiJobListData>("/api/admin/ai-model-ops/jobs"),
          ]);
        setOverview(nextOverview);
        setProviders(nextProviders);
        setEndpoints(nextEndpoints);
        setModels(nextModels);
        setBindings(nextBindings);
        setJobs(nextJobs);
        reconcileSelections(nextModels, nextBindings);
        return;
      }

      if (view === "providers") {
        const [nextProviders, nextEndpoints] = await Promise.all([
          requestEnvelope<AdminAiProviderListData>("/api/admin/ai-model-ops/providers"),
          requestEnvelope<AdminAiEndpointListData>(
            `/api/admin/ai-model-ops/endpoints?${endpointQuery.toString()}`
          ),
        ]);
        setProviders(nextProviders);
        setEndpoints(nextEndpoints);
        return;
      }

      if (view === "endpoints") {
        const [nextEndpoints, nextProviders, nextModels] = await Promise.all([
          requestEnvelope<AdminAiEndpointListData>(
            `/api/admin/ai-model-ops/endpoints?${endpointQuery.toString()}`
          ),
          requestEnvelope<AdminAiProviderListData>("/api/admin/ai-model-ops/providers"),
          requestEnvelope<AdminAiModelListData>("/api/admin/ai-model-ops/models?modality=image"),
        ]);
        setEndpoints(nextEndpoints);
        setProviders(nextProviders);
        setModels(nextModels);
        return;
      }

      if (view === "models") {
        const [nextModels, nextBindings, nextEndpoints] = await Promise.all([
          requestEnvelope<AdminAiModelListData>("/api/admin/ai-model-ops/models?modality=image"),
          requestEnvelope<AdminAiBindingListData>(
            "/api/admin/ai-model-ops/bindings?modality=image"
          ),
          requestEnvelope<AdminAiEndpointListData>(
            "/api/admin/ai-model-ops/endpoints?modality=image"
          ),
        ]);
        setModels(nextModels);
        setBindings(nextBindings);
        setEndpoints(nextEndpoints);
        reconcileSelections(nextModels, nextBindings);
        return;
      }

      setJobs(await requestEnvelope<AdminAiJobListData>("/api/admin/ai-model-ops/jobs"));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function reconcileSelections(
    nextModels: AdminAiModelListData,
    nextBindings: AdminAiBindingListData
  ) {
    setSelectedModel((current) =>
      current ? (nextModels.items.find((item) => item.id === current.id) ?? current) : current
    );
    setSelectedBinding((current) =>
      current ? (nextBindings.items.find((item) => item.id === current.id) ?? current) : current
    );
  }

  const loadJobDetail = useCallback(async (jobId: string) => {
    setDrawerError(null);
    try {
      setJobDetail(
        await requestEnvelope<AdminAiJobDetail>(`/api/admin/ai-model-ops/jobs/${jobId}`)
      );
    } catch (err) {
      setDrawerError(toErrorMessage(err));
    }
  }, []);

  function handleStatusFilter(next: StatusFilter) {
    setStatusFilter(next);
    void refresh(next);
  }

  function openModel(model: AdminAiCanonicalModel) {
    setDrawerError(null);
    setSelectedModel(model);
    setDrawerMode("model");
  }

  function openNewModel() {
    setDrawerError(null);
    setSelectedModel(null);
    setDrawerMode("model");
  }

  function openProvider(provider: AdminAiProviderAccount) {
    setDrawerError(null);
    setSelectedProvider(provider);
    setDrawerMode("provider");
  }

  function openEndpointBinding(endpoint: AdminAiProviderEndpoint) {
    setDrawerError(null);
    setBindingModel(null);
    setSelectedEndpoint(endpoint);
    setDrawerMode("endpointBinding");
  }

  // Open the create-binding drawer scoped to a canonical model from its inline bindings sub-table (pick endpoint, fixed model).
  function openModelBinding(model: AdminAiCanonicalModel) {
    setDrawerError(null);
    setSelectedEndpoint(null);
    setSelectedModel(model);
    setBindingModel(model);
    setDrawerMode("endpointBinding");
  }

  function openEndpoint(endpoint: AdminAiProviderEndpoint) {
    setDrawerError(null);
    setSelectedEndpoint(endpoint);
    setDrawerMode("endpoint");
  }

  function openNewEndpoint() {
    setDrawerError(null);
    setSelectedEndpoint(null);
    setDrawerMode("endpoint");
  }

  function openBinding(binding: AdminAiProviderBinding) {
    setDrawerError(null);
    setSelectedBinding(binding);
    setDrawerMode("binding");
  }

  function openJob(job: AdminAiJobListItem) {
    setDrawerError(null);
    setJobDetail(null);
    setSelectedJob(job);
    setDrawerMode("job");
  }

  function closeDrawer() {
    if (saving) return;
    setDrawerMode(null);
    setDrawerError(null);
    setSelectedProvider(null);
    setSelectedEndpoint(null);
    setBindingModel(null);
    setJobDetail(null);
  }

  // Archive a binding (soft-disable). The server exposes no hard-delete route, so removal = status: archived.
  async function archiveBinding(binding: AdminAiProviderBinding) {
    setSaving(true);
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/ai-model-ops/bindings/${binding.id}`,
        { status: "archived" },
        "PATCH"
      );
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function renderViewContent() {
    if (view === "overview") {
      return (
        <>
          <OverviewMetrics overview={overview} />
          <section className="grid gap-4 2xl:grid-cols-[0.86fr_1.14fr]">
            <OperationalReadinessPanel
              providers={providers.items}
              bindings={bindings.items}
              models={models.items}
              overview={overview}
              onOpenModel={openModel}
            />
            <RecentJobsOverviewPanel overview={overview} />
          </section>
        </>
      );
    }

    if (view === "providers") {
      return (
        <ProvidersPanel
          providers={providers.items}
          loading={loading || saving}
          onOpenProvider={openProvider}
          onStatusChange={async (provider, status) => {
            setSaving(true);
            setError(null);
            try {
              await mutateEnvelope(
                `/api/admin/ai-model-ops/providers/${provider.id}`,
                { status },
                "PATCH"
              );
              await refresh();
            } catch (err) {
              setError(toErrorMessage(err));
              throw err;
            } finally {
              setSaving(false);
            }
          }}
        />
      );
    }

    if (view === "endpoints") {
      return (
        <EndpointsPanel
          endpoints={endpoints.items}
          modelCount={models.items.length}
          loading={loading || saving}
          statusFilter={statusFilter}
          onStatusFilter={handleStatusFilter}
          onOpenEndpoint={openEndpoint}
          onOpenBinding={openEndpointBinding}
          onStatusChange={async (endpoint, status) => {
            setSaving(true);
            setError(null);
            try {
              await mutateEnvelope(
                `/api/admin/ai-model-ops/endpoints/${endpoint.id}`,
                { status },
                "PATCH"
              );
              await refresh();
            } catch (err) {
              setError(toErrorMessage(err));
              throw err;
            } finally {
              setSaving(false);
            }
          }}
          onArchiveEndpoint={async (endpoint) => {
            setSaving(true);
            setError(null);
            try {
              await mutateEnvelope(
                `/api/admin/ai-model-ops/endpoints/${endpoint.id}`,
                {},
                "DELETE"
              );
              await refresh();
            } catch (err) {
              setError(toErrorMessage(err));
              throw err;
            } finally {
              setSaving(false);
            }
          }}
        />
      );
    }

    if (view === "models") {
      return (
        <ModelsPanel
          models={models.items}
          bindings={bindings.items}
          endpoints={endpoints.items}
          loading={loading}
          saving={saving}
          onOpenModel={openModel}
          onAddBinding={openModelBinding}
          onOpenBinding={openBinding}
          onArchiveBinding={archiveBinding}
        />
      );
    }

    return <JobsPanel jobs={jobs.items} loading={loading} onOpenJob={openJob} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title={meta.title}
        description={meta.description}
        icon={meta.icon}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading || saving}
              className="h-9 rounded-lg"
            >
              <IconRefresh className={cn("size-4", loading && "animate-spin")} />
              刷新
            </Button>
            {meta.primaryAction === "new-model" ? (
              <Button
                type="button"
                onClick={openNewModel}
                disabled={loading || saving}
                className="h-9 rounded-lg bg-slate-950 text-white hover:bg-slate-800"
              >
                <IconPlus className="size-4" />
                新建统一模型
              </Button>
            ) : null}
            {meta.primaryAction === "new-endpoint" ? (
              <Button
                type="button"
                onClick={openNewEndpoint}
                disabled={loading || saving || providers.items.length === 0}
                className="h-9 rounded-lg bg-slate-950 text-white hover:bg-slate-800"
                title={providers.items.length === 0 ? "先创建供应商账号" : "新建供应商端点"}
              >
                <IconPlus className="size-4" />
                新建端点
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {renderViewContent()}

      <ProviderAccountDrawer
        open={drawerMode === "provider"}
        providerAccount={selectedProvider}
        saving={saving}
        error={drawerError}
        onClose={closeDrawer}
        onSave={async (event) => {
          event.preventDefault();
          if (!selectedProvider) return;
          setSaving(true);
          setDrawerError(null);
          try {
            const form = new FormData(event.currentTarget);
            await mutateEnvelope<AdminAiProviderAccount>(
              `/api/admin/ai-model-ops/providers/${selectedProvider.id}`,
              buildProviderAccountPayload(form),
              "PATCH"
            );
            await refresh();
            setDrawerMode(null);
            setSelectedProvider(null);
          } catch (err) {
            setDrawerError(toErrorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
      />

      <ModelPolicyDrawer
        open={drawerMode === "model"}
        model={selectedModel}
        saving={saving}
        error={drawerError}
        onClose={closeDrawer}
        onSave={async (event) => {
          event.preventDefault();
          setSaving(true);
          setDrawerError(null);
          try {
            const form = new FormData(event.currentTarget);
            if (selectedModel) {
              await mutateEnvelope(
                `/api/admin/ai-model-ops/models/${selectedModel.id}`,
                buildModelPayload(form),
                "PATCH"
              );
            } else {
              await mutateEnvelope("/api/admin/ai-model-ops/models", buildCreateModelPayload(form));
            }
            await refresh();
          } catch (err) {
            setDrawerError(toErrorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
      />

      <ProviderEndpointDrawer
        open={drawerMode === "endpoint"}
        endpoint={selectedEndpoint}
        providers={providers.items}
        saving={saving}
        error={drawerError}
        onClose={closeDrawer}
        onSave={async (event) => {
          event.preventDefault();
          setSaving(true);
          setDrawerError(null);
          try {
            const form = new FormData(event.currentTarget);
            if (selectedEndpoint) {
              await mutateEnvelope(
                `/api/admin/ai-model-ops/endpoints/${selectedEndpoint.id}`,
                buildProviderEndpointPayload(form),
                "PATCH"
              );
            } else {
              await mutateEnvelope(
                "/api/admin/ai-model-ops/endpoints",
                buildCreateProviderEndpointPayload(form)
              );
            }
            await refresh();
            setDrawerMode(null);
            setSelectedEndpoint(null);
          } catch (err) {
            setDrawerError(toErrorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
      />

      <EndpointBindingDrawer
        open={drawerMode === "endpointBinding"}
        endpoint={bindingModel ? null : selectedEndpoint}
        model={bindingModel}
        models={models.items}
        endpoints={endpoints.items}
        saving={saving}
        error={drawerError}
        onClose={closeDrawer}
        onSave={async (event) => {
          event.preventDefault();
          setSaving(true);
          setDrawerError(null);
          try {
            await mutateEnvelope(
              "/api/admin/ai-model-ops/bindings",
              buildCreateProviderBindingPayload(new FormData(event.currentTarget))
            );
            await refresh();
            closeDrawer();
          } catch (err) {
            setDrawerError(toErrorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
      />

      <BindingPolicyDrawer
        open={drawerMode === "binding"}
        binding={selectedBinding}
        saving={saving}
        error={drawerError}
        onClose={closeDrawer}
        onSave={async (event) => {
          event.preventDefault();
          if (!selectedBinding) return;
          setSaving(true);
          setDrawerError(null);
          try {
            const payload = buildProviderBindingPayload(new FormData(event.currentTarget));
            await mutateEnvelope(
              `/api/admin/ai-model-ops/bindings/${selectedBinding.id}`,
              payload,
              "PATCH"
            );
            await refresh();
            closeDrawer();
          } catch (err) {
            setDrawerError(toErrorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
      />

      <JobDetailDrawer
        open={drawerMode === "job"}
        job={selectedJob}
        detail={jobDetail}
        error={drawerError}
        onClose={closeDrawer}
        onLoad={loadJobDetail}
      />
    </div>
  );
}

function OverviewMetrics({ overview }: { overview: AdminAiOverviewData | null }) {
  const metrics = overview?.metrics;
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="供应商账号" value={metrics?.providerAccounts ?? 0} />
      <Metric label="供应商端点" value={metrics?.providerEndpoints ?? 0} />
      <Metric label="统一模型" value={metrics?.canonicalModels ?? 0} />
      <Metric label="Provider 绑定" value={metrics?.providerBindings ?? 0} />
      <Metric label="排队任务" value={metrics?.queuedJobs ?? 0} />
      <Metric label="运行任务" value={metrics?.runningJobs ?? 0} />
      <Metric
        label="24h 失败任务"
        value={metrics?.failedJobs24h ?? 0}
        tone={(metrics?.failedJobs24h ?? 0) > 0 ? "risk" : "default"}
      />
      <Metric
        label="DLQ 事件"
        value={metrics?.deadOutboxEvents ?? 0}
        tone={(metrics?.deadOutboxEvents ?? 0) > 0 ? "risk" : "default"}
      />
    </section>
  );
}

function providerLabel(provider: string) {
  return AI_PROVIDER_LABELS[provider as keyof typeof AI_PROVIDER_LABELS] ?? provider;
}

function OperationalReadinessPanel({
  providers,
  bindings,
  models,
  overview,
  onOpenModel,
}: {
  providers: AdminAiProviderAccount[];
  bindings: AdminAiProviderBinding[];
  models: AdminAiCanonicalModel[];
  overview: AdminAiOverviewData | null;
  onOpenModel: (model: AdminAiCanonicalModel) => void;
}) {
  const readiness = useMemo(
    () => computeReadiness(providers, bindings, models),
    [bindings, models, providers]
  );
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<IconShieldCheck className="size-4" />}
        title="上线就绪度"
        description="只汇总会影响前台生成闭环的 provider、统一模型路由、成本和告警风险。"
      />
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-950">
              {readiness.risks.length ? "需要处理" : "运行配置完整"}
            </p>
            <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
              {readiness.risks.length
                ? "这些问题会影响模型选择、任务路由、定价或生成稳定性。"
                : "当前站点具备可路由 provider、活跃 binding 和启用统一模型。"}
            </p>
          </div>
          <StatusPill tone={readiness.risks.length ? "risk" : "success"}>
            {readiness.risks.length ? `${readiness.risks.length} 项风险` : "可运行"}
          </StatusPill>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <PolicyStat label="活跃 Provider" value={readiness.activeProviders} />
          <PolicyStat label="活跃 Binding" value={readiness.activeBindings} />
          <PolicyStat label="启用模型" value={readiness.activeModels} />
          <PolicyStat
            label="24h Provider 成本"
            value={`$${(overview?.cost24h.providerCostUsd ?? 0).toFixed(4)}`}
          />
        </div>
        <div className="mt-4 space-y-2">
          {readiness.risks.length ? (
            readiness.risks.map((risk) => (
              <button
                key={risk.message}
                type="button"
                onClick={() => (risk.model ? onOpenModel(risk.model) : null)}
                className="flex w-full items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-left text-[12px] leading-5 text-red-700"
              >
                <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{risk.message}</span>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] leading-5 text-emerald-700">
              当前控制面没有检测到会阻断图片生成闭环的配置风险。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function RecentJobsOverviewPanel({ overview }: { overview: AdminAiOverviewData | null }) {
  const recentJobs = overview?.recentJobs ?? [];
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<IconFileSearch className="size-4" />}
        title="最近请求"
        description="总览只展示最近 request 的状态摘要；完整证据进入「请求任务」二级页面。"
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {recentJobs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">暂无最近任务。</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentJobs.slice(0, 6).map((job) => (
              <div
                key={job.id}
                className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_160px_120px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] font-medium text-slate-950">
                    {job.id}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-slate-500">
                    {job.canonicalModel?.displayName ?? job.modelId} ·{" "}
                    {job.providerBinding?.endpointId ?? job.provider}
                  </p>
                </div>
                <div className="flex items-center">
                  <JobStatusPill status={job.status} />
                </div>
                <span className="self-center text-[12px] text-slate-500">
                  {formatDate(job.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProvidersPanel({
  providers,
  loading,
  onOpenProvider,
  onStatusChange,
}: {
  providers: AdminAiProviderAccount[];
  loading: boolean;
  onOpenProvider: (provider: AdminAiProviderAccount) => void;
  onStatusChange: (
    provider: AdminAiProviderAccount,
    status: "active" | "disabled"
  ) => Promise<void>;
}) {
  const columns = useMemo<ColumnDef<AdminAiProviderAccount, unknown>[]>(
    () => [
      {
        accessorKey: "provider",
        header: "Provider",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div>
              <p className="text-sm font-medium text-slate-950">{providerLabel(item.provider)}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">{item.provider}</p>
            </div>
          );
        },
      },
      {
        id: "status",
        header: "状态",
        enableSorting: false,
        cell: ({ row }) => <AiStatusPill status={row.original.status} />,
      },
      {
        accessorKey: "bindingCount",
        header: "端点 / 绑定",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-slate-700">
            {row.original.endpointCount} / {row.original.bindingCount}
          </span>
        ),
      },
      {
        id: "updated",
        header: "更新",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">{formatDate(row.original.updatedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[180px]" },
        cell: ({ row }) => {
          const item = row.original;
          const active = item.status === "active";
          const nextStatus = active ? "disabled" : "active";
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenProvider(item)}
                className="h-8 rounded-lg px-2.5 text-[12px]"
              >
                <IconEdit className="size-3.5" />
                编辑
              </Button>
              <ConfirmDialog
                title={active ? "停用供应商账号？" : "启用供应商账号？"}
                description={
                  active
                    ? `停用「${providerLabel(item.provider)}」后，这个账号下的 provider 路由不应继续承接新任务。`
                    : `启用「${providerLabel(item.provider)}」后，已激活的绑定可以重新参与路由。`
                }
                confirmLabel={active ? "停用" : "启用"}
                destructive={active}
                onConfirm={() => onStatusChange(item, nextStatus)}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px]"
                    disabled={item.status === "archived"}
                  >
                    {active ? (
                      <IconCircleOff className="size-3.5" />
                    ) : (
                      <IconCircleCheck className="size-3.5" />
                    )}
                    {active ? "停用" : "启用"}
                  </Button>
                }
              />
            </div>
          );
        },
      },
    ],
    [onOpenProvider, onStatusChange]
  );
  return (
    <section className="space-y-3">
      <DataTable
        data={providers}
        columns={columns}
        loading={loading}
        minWidth={1080}
        emptyLabel="暂无供应商账号。"
      />
    </section>
  );
}

function EndpointsPanel({
  endpoints,
  modelCount,
  loading,
  statusFilter,
  onStatusFilter,
  onOpenEndpoint,
  onOpenBinding,
  onStatusChange,
  onArchiveEndpoint,
}: {
  endpoints: AdminAiProviderEndpoint[];
  modelCount: number;
  loading: boolean;
  statusFilter: StatusFilter;
  onStatusFilter: (status: StatusFilter) => void;
  onOpenEndpoint: (endpoint: AdminAiProviderEndpoint) => void;
  onOpenBinding: (endpoint: AdminAiProviderEndpoint) => void;
  onStatusChange: (
    endpoint: AdminAiProviderEndpoint,
    status: "active" | "disabled"
  ) => Promise<void>;
  onArchiveEndpoint: (endpoint: AdminAiProviderEndpoint) => Promise<void>;
}) {
  const columns = useMemo<ColumnDef<AdminAiProviderEndpoint, unknown>[]>(
    () => [
      {
        accessorKey: "endpointId",
        header: "Endpoint",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-950">
                {item.displayName ?? item.endpointId}
              </p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-500">{item.endpointId}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">{providerLabel(item.provider)}</p>
            </div>
          );
        },
      },
      {
        id: "status",
        header: "状态",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <AiStatusPill status={row.original.status} />
            <HealthPill status={row.original.healthStatus} />
          </div>
        ),
      },
      {
        id: "modes",
        header: "能力",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-[240px] text-[12px] text-slate-600">
            {modePreview(row.original.supportedModes)}
          </span>
        ),
      },
      {
        accessorKey: "bindingCount",
        header: "绑定",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-slate-700">{row.original.bindingCount}</span>
        ),
      },
      {
        id: "updated",
        header: "更新",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">{formatDate(row.original.updatedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[330px]" },
        cell: ({ row }) => {
          const item = row.original;
          const active = item.status === "active";
          const nextStatus = active ? "disabled" : "active";
          const bindingDisabled = modelCount === 0 || item.bindingCount > 0;
          const archived = item.status === "archived";
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenEndpoint(item)}
                className="h-8 rounded-lg px-2.5 text-[12px]"
              >
                <IconEdit className="size-3.5" />
                编辑
              </Button>
              <ConfirmDialog
                title={active ? "停用供应商端点？" : "启用供应商端点？"}
                description={
                  active
                    ? `停用「${item.displayName ?? item.endpointId}」后，绑定到它的路由不应承接新任务。`
                    : `启用「${item.displayName ?? item.endpointId}」后，健康且已绑定的路由可以参与调度。`
                }
                confirmLabel={active ? "停用" : "启用"}
                destructive={active}
                onConfirm={() => onStatusChange(item, nextStatus)}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px]"
                    disabled={archived}
                  >
                    {active ? (
                      <IconCircleOff className="size-3.5" />
                    ) : (
                      <IconCircleCheck className="size-3.5" />
                    )}
                    {active ? "停用" : "启用"}
                  </Button>
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenBinding(item)}
                disabled={bindingDisabled || archived}
                className="h-8 rounded-lg px-2.5 text-[12px]"
                title={
                  modelCount === 0
                    ? "先创建统一模型"
                    : item.bindingCount > 0
                      ? "该 endpoint 已有路由绑定"
                      : "绑定到统一模型"
                }
              >
                {item.bindingCount > 0 ? "已绑定" : "绑定"}
              </Button>
              <ConfirmDialog
                title="归档供应商端点？"
                description={
                  item.bindingCount > 0
                    ? "该端点仍有 Provider 绑定，必须先归档绑定后再删除端点。"
                    : `归档「${item.displayName ?? item.endpointId}」不会删除历史任务证据。`
                }
                confirmLabel="归档"
                destructive
                onConfirm={() => onArchiveEndpoint(item)}
                trigger={
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px]"
                    disabled={archived || item.bindingCount > 0}
                  >
                    <IconTrash className="size-3.5" />
                    删除
                  </Button>
                }
              />
            </div>
          );
        },
      },
    ],
    [modelCount, onArchiveEndpoint, onOpenBinding, onOpenEndpoint, onStatusChange]
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <SectionTitle
          icon={<IconDatabaseSearch className="size-4" />}
          title="供应商端点库存"
          description="手动维护真实 provider endpoint；端点进入路由前必须显式绑定到统一模型。"
        />
        <label className="grid gap-1 text-[12px] font-medium text-slate-500">
          端点状态
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.currentTarget.value as StatusFilter)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="">全部</option>
            <option value="draft">草稿</option>
            <option value="active">启用</option>
            <option value="disabled">停用</option>
            <option value="degraded">降级</option>
          </select>
        </label>
      </div>
      <DataTable
        data={endpoints}
        columns={columns}
        loading={loading}
        minWidth={1360}
        pageSize={10}
        emptyLabel="暂无供应商端点。请先手动新建真实 provider endpoint。"
      />
    </section>
  );
}

function ModelsPanel({
  models,
  bindings,
  endpoints,
  loading,
  saving,
  onOpenModel,
  onAddBinding,
  onOpenBinding,
  onArchiveBinding,
}: {
  models: AdminAiCanonicalModel[];
  bindings: AdminAiProviderBinding[];
  endpoints: AdminAiProviderEndpoint[];
  loading: boolean;
  saving: boolean;
  onOpenModel: (model: AdminAiCanonicalModel) => void;
  onAddBinding: (model: AdminAiCanonicalModel) => void;
  onOpenBinding: (binding: AdminAiProviderBinding) => void;
  onArchiveBinding: (binding: AdminAiProviderBinding) => Promise<void>;
}) {
  const columns = useMemo<ColumnDef<AdminAiCanonicalModel, unknown>[]>(
    () => [
      {
        id: "expander",
        header: "",
        enableSorting: false,
        meta: { cellClassName: "w-[44px]" },
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            disabled={!row.getCanExpand()}
            aria-label={row.getIsExpanded() ? "收起路由绑定" : "展开路由绑定"}
            className="grid size-7 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:text-slate-900 disabled:opacity-40"
          >
            {row.getIsExpanded() ? (
              <IconChevronDown className="size-4" />
            ) : (
              <IconChevronRight className="size-4" />
            )}
          </button>
        ),
      },
      {
        accessorKey: "displayName",
        header: "统一模型",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div>
              <p className="text-sm font-medium text-slate-950">{item.displayName}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {item.slug} · {item.family}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <AiStatusPill status={row.original.status} />,
      },
      {
        id: "price-band",
        header: "价格带",
        enableSorting: false,
        cell: ({ row }) => {
          const priceBand = row.original.priceBand;
          if (!priceBand) {
            return <span className="text-[12px] text-slate-400">未配置</span>;
          }
          const range =
            priceBand.minPoints === priceBand.maxPoints
              ? `${priceBand.minPoints}`
              : `${priceBand.minPoints} - ${priceBand.maxPoints}`;
          return (
            <div
              className="leading-tight"
              title={[
                priceBand.minLabel ? `最低 ${priceBand.minLabel}` : null,
                priceBand.maxLabel ? `最高 ${priceBand.maxLabel}` : null,
                `版本 ${priceBand.pricingVersion}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <p className="text-[13px] font-semibold tabular-nums text-[#E52227]">
                {range} 积分/张
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                默认 {priceBand.defaultPoints} · 最高质量 {priceBand.maxLabel ?? "最高档"}
              </p>
            </div>
          );
        },
      },
      {
        id: "counts",
        header: "链路",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-600">
            {row.original.bindingCount} provider · {row.original.jobCount} 任务
          </span>
        ),
      },
      {
        id: "policy",
        header: "运行策略",
        enableSorting: false,
        cell: ({ row }) => <ModelRuntimePolicyCell model={row.original} />,
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[110px]" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenModel(row.original)}
              className="h-8 rounded-lg px-3 text-[12px]"
            >
              策略
            </Button>
          </div>
        ),
      },
    ],
    [onOpenModel]
  );
  return (
    <section className="space-y-3">
      <DataTable
        data={models}
        columns={columns}
        loading={loading}
        minWidth={980}
        pageSize={8}
        emptyLabel="暂无统一模型。请先手动创建产品模型，再绑定供应商端点。"
        renderExpanded={(model) => (
          <ModelBindingsSubTable
            model={model}
            bindings={bindings}
            endpoints={endpoints}
            saving={saving}
            onAddBinding={onAddBinding}
            onOpenBinding={onOpenBinding}
            onArchiveBinding={onArchiveBinding}
          />
        )}
      />
    </section>
  );
}

/**
 * Inline, model-scoped Provider 绑定 sub-table, rendered into the expanded row of the 统一模型 list.
 * It is the runtime truth surface for one canonical model's routing, and lets the operator:
 * - add a binding (pick an existing endpoint, set priority / weight / status) via the create flow,
 * - edit a binding's routing via the existing BindingPolicyDrawer,
 * - archive (soft-remove) a binding via status: archived.
 * Snapshotted provider schemas stay read-only/informational; product pricing,
 * user-facing parameter policy, queue policy, and observability are owned by
 * the canonical model.
 */
function ModelBindingsSubTable({
  model,
  bindings,
  endpoints,
  saving,
  onAddBinding,
  onOpenBinding,
  onArchiveBinding,
}: {
  model: AdminAiCanonicalModel;
  bindings: AdminAiProviderBinding[];
  endpoints: AdminAiProviderEndpoint[];
  saving: boolean;
  onAddBinding: (model: AdminAiCanonicalModel) => void;
  onOpenBinding: (binding: AdminAiProviderBinding) => void;
  onArchiveBinding: (binding: AdminAiProviderBinding) => Promise<void>;
}) {
  const modelBindings = useMemo(
    () => bindings.filter((item) => item.canonicalModel?.id === model.id),
    [bindings, model]
  );
  const bindableEndpoints = useMemo(
    () =>
      endpoints.filter((item) => item.modality === model.modality && item.status !== "archived"),
    [endpoints, model]
  );
  const columns = useMemo<ColumnDef<AdminAiProviderBinding, unknown>[]>(
    () => [
      {
        accessorKey: "endpointId",
        header: "Provider / Endpoint",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div>
              <p className="text-sm font-medium text-slate-950">
                {item.displayName ?? item.endpointId}
              </p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-500">{item.endpointId}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">{providerLabel(item.provider)}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <AiStatusPill status={row.original.status} />,
      },
      {
        id: "route",
        header: "路由",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-600">
            P{row.original.priority} · W{row.original.weight}
          </span>
        ),
      },
      {
        id: "activity",
        header: "活动",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-600">{row.original.jobCount} 任务</span>
        ),
      },
      {
        id: "updated",
        header: "更新",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">{formatDate(row.original.updatedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[200px]" },
        cell: ({ row }) => {
          const item = row.original;
          const archived = item.status === "archived";
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenBinding(item)}
                className="h-8 rounded-lg px-3 text-[12px]"
              >
                <IconEdit className="size-3.5" />
                路由
              </Button>
              <ConfirmDialog
                title="归档 Provider 绑定？"
                description={`归档「${item.displayName ?? item.endpointId}」后，该 provider 路由不再参与这个统一模型的调度。可重新编辑路由恢复状态。`}
                confirmLabel="归档"
                destructive
                onConfirm={() => onArchiveBinding(item)}
                trigger={
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px]"
                    disabled={archived}
                  >
                    <IconTrash className="size-3.5" />
                    归档
                  </Button>
                }
              />
            </div>
          );
        },
      },
    ],
    [onArchiveBinding, onOpenBinding]
  );

  return (
    <div className="px-5 py-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <SectionTitle
          icon={<IconRoute className="size-4" />}
          title="路由绑定"
          description="为这个统一模型挑选 provider endpoint，并配置 priority / weight / status 路由。产品积分定价只属于统一模型。"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAddBinding(model)}
          disabled={saving || bindableEndpoints.length === 0}
          className="h-9 rounded-lg px-3 text-[12px]"
          title={
            bindableEndpoints.length === 0
              ? "先在「供应商端点」创建可用 endpoint"
              : "绑定一个 provider endpoint"
          }
        >
          <IconPlus className="size-3.5" />
          新建绑定
        </Button>
      </div>
      <div className="mt-3">
        <DataTable
          data={modelBindings}
          columns={columns}
          pageSize={8}
          emptyLabel="该统一模型还没有绑定 provider endpoint。"
        />
      </div>
    </div>
  );
}

function ModelRuntimePolicyCell({ model }: { model: AdminAiCanonicalModel }) {
  const parameter = asRecord(model.parameterPolicy);
  const queue = asRecord(model.queuePolicy);
  const queueName =
    stringFromRecord(queue, "queueName") ??
    (model.modality === "video" ? "ai-video-generation" : "ai-image-generation");
  const defaults = [
    stringFromRecord(parameter, "defaultResolution"),
    stringFromRecord(parameter, "defaultQuality"),
    stringFromRecord(parameter, "defaultAspectRatio"),
  ]
    .filter(Boolean)
    .join(" / ");
  const concurrency = `G${numberFromRecord(queue, "globalConcurrency") ?? "-"} · U${
    numberFromRecord(queue, "perUserRunning") ?? "-"
  }/${numberFromRecord(queue, "perUserQueued") ?? "-"}`;

  return (
    <div className="min-w-[230px] leading-tight">
      <p className="text-[12px] font-medium text-slate-700">
        {queueName} · {concurrency}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {defaults ? `默认 ${defaults}` : "参数策略未配置"}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">路由按绑定 P/W 执行 · 重试保持提交时路由</p>
    </div>
  );
}

function JobsPanel({
  jobs,
  loading,
  onOpenJob,
}: {
  jobs: AdminAiJobListItem[];
  loading: boolean;
  onOpenJob: (job: AdminAiJobListItem) => void;
}) {
  const columns = useMemo<ColumnDef<AdminAiJobListItem, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        header: "FizzDragon job ID",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div>
              <p className="font-mono text-[12px] font-medium text-slate-950">{item.id}</p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-500">
                {item.providerJobId
                  ? `Provider job ID · ${item.providerJobId}`
                  : "Provider job ID -"}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <JobStatusPill status={row.original.status} />,
      },
      {
        accessorKey: "modelId",
        header: "模型",
        cell: ({ row }) => (
          <div>
            <p className="text-[13px] font-medium text-slate-900">
              {row.original.canonicalModel?.displayName ?? row.original.modelId}
            </p>
            <p className="text-[12px] text-slate-500">
              {row.original.providerBinding?.endpointId ?? row.original.provider}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "prompt",
        header: "Prompt",
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-[360px] text-[12px] leading-5 text-slate-600">
            {row.original.prompt || "-"}
          </span>
        ),
      },
      {
        id: "attempt",
        header: "Attempt",
        cell: ({ row }) => {
          const attempt = row.original.attempts[0];
          return attempt ? (
            <div className="text-[12px] text-slate-600">
              <p>
                #{attempt.attemptNumber} · {attempt.status}
              </p>
              <p className="text-slate-500">
                {attempt.providerRequestId ?? "-"} · {attempt.runDurationMs ?? "-"}ms
              </p>
            </div>
          ) : (
            <span className="text-[12px] text-slate-400">-</span>
          );
        },
      },
      {
        id: "cost",
        header: "成本",
        cell: ({ row }) => {
          const providerCost = latestProviderCost(row.original);
          const quotaCost = quotaCostFromRoutingSnapshot(row.original.routingSnapshot);
          const profit = grossProfitFromCosts(quotaCost, providerCost);
          return (
            <div className="text-[12px] leading-5">
              <p className="font-medium text-slate-900">
                {quotaCost != null ? `${quotaCost} 积分` : "-"}
              </p>
              {providerCost ? (
                <p className="font-mono text-slate-500">
                  {formatMoney(providerCost.amount, providerCost.currency)}
                </p>
              ) : null}
              {profit ? (
                <p className="font-mono text-emerald-700">
                  {formatProfitUsd(profit.grossProfitUsd)} · {formatPercent(profit.margin)}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "创建",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "证据",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenJob(row.original)}
            className="h-8 rounded-lg px-3 text-[12px]"
          >
            详情
          </Button>
        ),
      },
    ],
    [onOpenJob]
  );
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<IconFileSearch className="size-4" />}
        title="最近 AI 任务"
        description="每个 request 的输入、输出、timing、成本和 provider 原始证据都应可追踪。"
      />
      <DataTable
        data={jobs}
        columns={columns}
        loading={loading}
        minWidth={1220}
        pageSize={10}
        emptyLabel="暂无 AI 任务。"
      />
    </section>
  );
}

function ProviderAccountDrawer({
  open,
  providerAccount,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  providerAccount: AdminAiProviderAccount | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!providerAccount) return null;
  const draft = providerAccount;
  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent
        className={AI_MODEL_SHEET_CLASSNAME}
        style={AI_PROVIDER_ACCOUNT_DRAWER_STYLE}
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>编辑供应商账号</SheetTitle>
          <SheetDescription className="font-mono text-[12px] text-slate-500">
            {draft.provider}
          </SheetDescription>
        </SheetHeader>
        <form
          id="ai-provider-account-form"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
          onSubmit={onSave}
        >
          {error ? <ErrorBanner message={error} /> : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
            账号身份由代码侧对账维护；密钥从环境变量读取，这里只编辑账号状态。
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <FormField field={PROVIDER_ACCOUNT_FIELDS.provider}>
              <ReadOnlyValue primary={providerLabel(draft.provider)} secondary={draft.provider} />
            </FormField>
            <FormField field={PROVIDER_ACCOUNT_FIELDS.status}>
              {(controlProps) => (
                <NativeSelect {...controlProps} defaultValue={draft.status}>
                  <option value="draft">草稿</option>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                  <option value="degraded">降级</option>
                </NativeSelect>
              )}
            </FormField>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ReadOnlyValue primary={`${providerAccount.endpointCount}`} secondary="供应商端点" />
            <ReadOnlyValue primary={`${providerAccount.bindingCount}`} secondary="Provider 绑定" />
          </div>
          <p className="mt-4 text-[12px] leading-5 text-slate-500">
            key 级出站限流 / 月度花费上限。
            <span className="text-amber-600">暂未强制执行</span>
            ——provider-aware 排队接入后生效。
          </p>
          <div className="mt-2 grid gap-3">
            <JsonTextarea
              field={PROVIDER_ACCOUNT_FIELDS.rateLimitPolicy}
              value={draft.rateLimitPolicy}
              rows={6}
            />
            <JsonTextarea
              field={PROVIDER_ACCOUNT_FIELDS.quotaPolicy}
              value={draft.quotaPolicy}
              rows={6}
            />
          </div>
        </form>
        <SheetFooter className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" form="ai-provider-account-form" disabled={saving}>
              {saving ? "保存中…" : "保存账号"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ModelPolicyDrawer({
  open,
  model,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  model: AdminAiCanonicalModel | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const draft = model ?? defaultModelDraft();
  const creating = !model;
  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent
        className={AI_MODEL_SHEET_CLASSNAME}
        style={AI_MODEL_POLICY_DRAWER_STYLE}
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>{creating ? "新建统一模型" : "统一模型策略"}</SheetTitle>
          <SheetDescription className="font-mono text-[12px] text-slate-500">
            {creating ? "人工维护用户侧模型身份，再绑定供应商端点。" : draft.slug}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <form id="ai-model-form" onSubmit={onSave}>
            {error ? <ErrorBanner message={error} /> : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <FormField
                field={MODEL_POLICY_FIELDS.slug}
                required={creating}
                hint={creating ? "创建后不可变，必须与前台模型身份一一对应。" : "创建后不可变。"}
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    disabled={!creating}
                    defaultValue={draft.slug}
                    className="h-9 rounded-lg"
                    placeholder="gpt-image-2"
                  />
                )}
              </FormField>
              <FormField field={MODEL_POLICY_FIELDS.modality} required={creating}>
                {(controlProps) => (
                  <NativeSelect
                    {...controlProps}
                    defaultValue={draft.modality}
                    disabled={!creating}
                  >
                    <option value="image">图片</option>
                    <option value="video">视频</option>
                  </NativeSelect>
                )}
              </FormField>
              <FormField field={MODEL_POLICY_FIELDS.displayName}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    defaultValue={draft.displayName}
                    className="h-9 rounded-lg"
                  />
                )}
              </FormField>
              <FormField field={MODEL_POLICY_FIELDS.family}>
                {(controlProps) => (
                  <Input {...controlProps} defaultValue={draft.family} className="h-9 rounded-lg" />
                )}
              </FormField>
              <FormField field={MODEL_POLICY_FIELDS.status}>
                {(controlProps) => (
                  <NativeSelect {...controlProps} defaultValue={draft.status}>
                    <option value="draft">草稿</option>
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                    <option value="degraded">降级</option>
                  </NativeSelect>
                )}
              </FormField>
            </div>
            <FormField field={MODEL_POLICY_FIELDS.description} optional className="mt-3">
              {(controlProps) => (
                <Textarea
                  {...controlProps}
                  defaultValue={draft.description ?? ""}
                  className="min-h-20 rounded-lg"
                />
              )}
            </FormField>
            <ModelPolicySummary model={draft} />
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <JsonTextarea
                field={MODEL_POLICY_FIELDS.generationModes}
                value={draft.generationModes}
                rows={10}
              />
              <JsonTextarea
                field={MODEL_POLICY_FIELDS.parameterPolicy}
                value={draft.parameterPolicy}
                rows={10}
              />
              <JsonTextarea
                field={MODEL_POLICY_FIELDS.billingPolicy}
                value={draft.billingPolicy}
                rows={10}
              />
              <JsonTextarea
                field={MODEL_POLICY_FIELDS.queuePolicy}
                value={draft.queuePolicy}
                rows={10}
              />
              <JsonTextarea
                field={MODEL_POLICY_FIELDS.entitlementPolicy}
                value={draft.entitlementPolicy}
                rows={10}
              />
              <JsonTextarea
                field={MODEL_POLICY_FIELDS.observabilityPolicy}
                value={draft.observabilityPolicy}
                rows={10}
              />
              <JsonTextarea field={MODEL_POLICY_FIELDS.uiPolicy} value={draft.uiPolicy} rows={10} />
              <JsonTextarea field={MODEL_POLICY_FIELDS.metadata} value={draft.metadata} rows={10} />
            </div>
          </form>
        </div>
        <SheetFooter className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" form="ai-model-form" disabled={saving}>
              {saving ? "保存中…" : creating ? "创建模型" : "保存策略"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ModelPolicySummary({ model }: { model: AdminAiCanonicalModel }) {
  const parameter = asRecord(model.parameterPolicy);
  const queue = asRecord(model.queuePolicy);
  const observability = asRecord(model.observabilityPolicy);
  const priceBand = model.priceBand;
  const resolutionOptions = compactArray(parameter.resolutionOptions).join(" / ");
  const qualityOptions = compactArray(parameter.qualityOptions).join(" / ");
  const aspectRatios = compactArray(parameter.supportedAspectRatios).join(" / ");
  const queueName =
    typeof queue.queueName === "string" && queue.queueName.trim()
      ? queue.queueName
      : model.modality === "video"
        ? "ai-video-generation"
        : "ai-image-generation";
  const runtimeSeconds = numberFromRecord(queue, "maxProviderRuntimeSeconds");
  const alertSeconds = numberFromRecord(observability, "alertOnQueueWaitSeconds");

  return (
    <section className="mt-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          模型级运行策略
        </p>
        <span className="text-[11px] text-slate-400">Provider 绑定只负责路由。</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <PolicyStat
          label="用户价格"
          value={
            priceBand
              ? priceBand.minPoints === priceBand.maxPoints
                ? `${priceBand.minPoints} 积分/张`
                : `${priceBand.minPoints}-${priceBand.maxPoints} 积分/张`
              : "未配置"
          }
        />
        <PolicyStat
          label="默认价格"
          value={priceBand ? `${priceBand.defaultPoints} 积分` : "未配置"}
        />
        <PolicyStat label="队列" value={queueName} />
        <PolicyStat
          label="并发"
          value={`G${numberFromRecord(queue, "globalConcurrency") ?? "-"} · U${
            numberFromRecord(queue, "perUserRunning") ?? "-"
          }/${numberFromRecord(queue, "perUserQueued") ?? "-"}`}
        />
        <PolicyStat
          label="参数默认"
          value={[
            stringFromRecord(parameter, "defaultResolution"),
            stringFromRecord(parameter, "defaultQuality"),
            stringFromRecord(parameter, "defaultAspectRatio"),
          ]
            .filter(Boolean)
            .join(" / ")}
        />
        <PolicyStat label="分辨率" value={resolutionOptions || "未声明"} />
        <PolicyStat label="质量档" value={qualityOptions || "未声明"} />
        <PolicyStat label="画幅" value={aspectRatios || "未声明"} />
        <PolicyStat
          label="运行超时"
          value={runtimeSeconds != null ? `${runtimeSeconds}s` : "默认"}
        />
        <PolicyStat label="队列告警" value={alertSeconds != null ? `${alertSeconds}s` : "未配置"} />
      </div>
    </section>
  );
}

function ProviderEndpointDrawer({
  open,
  endpoint,
  providers,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  endpoint: AdminAiProviderEndpoint | null;
  providers: AdminAiProviderAccount[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const draft = endpoint ?? defaultProviderEndpointDraft(providers);
  const creating = !endpoint;
  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent
        className={AI_MODEL_SHEET_CLASSNAME}
        style={AI_PROVIDER_ENDPOINT_DRAWER_STYLE}
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>{creating ? "新建供应商端点" : "编辑供应商端点"}</SheetTitle>
          <SheetDescription className="font-mono text-[12px] text-slate-500">
            {creating
              ? "端点是真实 provider 模型库存；创建后再绑定到统一模型。"
              : `${providerLabel(draft.provider)} / ${draft.endpointId}`}
          </SheetDescription>
        </SheetHeader>
        <form
          id="ai-provider-endpoint-form"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
          onSubmit={onSave}
        >
          {error ? <ErrorBanner message={error} /> : null}
          {creating && providers.length === 0 ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-800">
              请先创建供应商账号并保存密钥，然后再维护这个账号下的真实 endpoint。
            </div>
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
            这里维护 provider 的真实模型端点、schema、成本快照和配额边界；用户侧只看统一模型。
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField
              field={PROVIDER_ENDPOINT_FIELDS.providerAccountId}
              required={creating}
              hint={creating ? "创建后不可变。切换账号请新建端点。" : "创建后不可变。"}
            >
              {(controlProps) => (
                <NativeSelect
                  {...controlProps}
                  defaultValue={draft.providerAccountId}
                  disabled={!creating}
                >
                  <option value="" disabled>
                    选择供应商账号
                  </option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {providerLabel(provider.provider)} · {provider.provider}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              field={PROVIDER_ENDPOINT_FIELDS.endpointId}
              required={creating}
              hint={
                creating
                  ? "例如 fal model id、百炼 model code、OpenAI model id。"
                  : "创建后不可变。"
              }
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  defaultValue={draft.endpointId}
                  disabled={!creating}
                  className="h-9 rounded-lg font-mono"
                  placeholder="fal-ai/flux-pro/kontext"
                />
              )}
            </FormField>
            <FormField field={PROVIDER_ENDPOINT_FIELDS.displayName}>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  defaultValue={draft.displayName ?? ""}
                  className="h-9 rounded-lg"
                  placeholder="Flux Kontext Pro"
                />
              )}
            </FormField>
            <FormField field={PROVIDER_ENDPOINT_FIELDS.modality} required={creating}>
              {(controlProps) => (
                <NativeSelect {...controlProps} defaultValue={draft.modality} disabled={!creating}>
                  <option value="image">图片</option>
                  <option value="video">视频</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField field={PROVIDER_ENDPOINT_FIELDS.status}>
              {(controlProps) => (
                <NativeSelect {...controlProps} defaultValue={draft.status}>
                  <option value="draft">草稿</option>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                  <option value="degraded">降级</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField field={PROVIDER_ENDPOINT_FIELDS.healthStatus}>
              {(controlProps) => (
                <NativeSelect {...controlProps} defaultValue={draft.healthStatus}>
                  <option value="unknown">未知</option>
                  <option value="healthy">健康</option>
                  <option value="degraded">降级</option>
                  <option value="outage">故障</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField
              field={PROVIDER_ENDPOINT_FIELDS.disabledReason}
              optional
              className="md:col-span-2"
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  defaultValue={draft.disabledReason ?? ""}
                  className="h-9 rounded-lg"
                  placeholder="停用或降级时记录原因"
                />
              )}
            </FormField>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <SupportedModesControl value={draft.supportedModes} />
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <p className="text-[12px] font-semibold text-slate-700">Provider capacity</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                  Static safety limits for this provider endpoint. Runtime lowers model concurrency
                  against these values and freezes the selected controls on each job.
                </p>
              </div>
              <NumberInputField
                field={PROVIDER_ENDPOINT_FIELDS.maxConcurrentRequests}
                value={draft.maxConcurrentRequests}
                placeholder="例如 4"
                min={1}
                max={1000}
              />
              <NumberInputField
                field={PROVIDER_ENDPOINT_FIELDS.maxRequestsPerMinute}
                value={draft.maxRequestsPerMinute}
                placeholder="例如 60"
                min={1}
                max={100000}
              />
              <NumberInputField
                field={PROVIDER_ENDPOINT_FIELDS.requestTimeoutSeconds}
                value={draft.requestTimeoutSeconds}
                placeholder="例如 600"
                min={1}
                max={86400}
              />
              <NumberInputField
                field={PROVIDER_ENDPOINT_FIELDS.cooldownSeconds}
                value={draft.cooldownSeconds}
                placeholder="例如 120"
                min={0}
                max={86400}
              />
              <NumberInputField
                field={PROVIDER_ENDPOINT_FIELDS.failureThreshold}
                value={draft.failureThreshold}
                placeholder="例如 3"
                min={1}
                max={100}
              />
            </div>
            <JsonTextarea
              field={PROVIDER_ENDPOINT_FIELDS.providerInputSchema}
              value={draft.providerInputSchema}
              rows={12}
            />
            <JsonTextarea
              field={PROVIDER_ENDPOINT_FIELDS.providerOutputSchema}
              value={draft.providerOutputSchema}
              rows={12}
            />
            <JsonTextarea
              field={PROVIDER_ENDPOINT_FIELDS.catalogSnapshot}
              value={draft.catalogSnapshot}
              rows={10}
            />
          </div>
        </form>
        <SheetFooter className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              type="submit"
              form="ai-provider-endpoint-form"
              disabled={saving || (creating && providers.length === 0)}
            >
              {saving ? "保存中…" : creating ? "创建端点" : "保存端点"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Create-binding drawer. Supports two entry points:
 * - From an endpoint (供应商端点页): a fixed `endpoint`, operator picks the canonical model.
 * - From a canonical model (统一模型详情): a fixed `model`, operator picks an endpoint.
 * Either way the create payload carries both `providerEndpointId` + `canonicalModelId`.
 * Provider schema snapshots stay read-only; routing (status/priority/weight)
 * is the only editable target.
 */
function EndpointBindingDrawer({
  open,
  endpoint,
  model,
  models,
  endpoints,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  /** Fixed endpoint (endpoints-page flow). */
  endpoint: AdminAiProviderEndpoint | null;
  /** Fixed canonical model (model-detail flow). */
  model: AdminAiCanonicalModel | null;
  /** Pickable models (endpoints-page flow). */
  models: AdminAiCanonicalModel[];
  /** Pickable endpoints (model-detail flow). */
  endpoints: AdminAiProviderEndpoint[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fromModel = Boolean(model);

  const bindableEndpoints = useMemo(
    () =>
      model
        ? endpoints.filter((item) => item.modality === model.modality && item.status !== "archived")
        : [],
    [endpoints, model]
  );

  // Track the picked endpoint to drive the read-only snapshot panel + submit gating.
  // Reset to the first bindable endpoint whenever the drawer (re)opens for a model —
  // done via the "adjust state during render" pattern to avoid a setState-in-effect.
  const [selectedEndpointId, setSelectedEndpointId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const nextPickerKey = open ? `${fromModel ? "m" : "e"}:${model?.id ?? endpoint?.id ?? ""}` : null;
  if (nextPickerKey !== pickerKey) {
    setPickerKey(nextPickerKey);
    setSelectedEndpointId(open && fromModel ? (bindableEndpoints[0]?.id ?? "") : "");
    setSelectedModelId(open && !fromModel ? (models[0]?.id ?? "") : "");
  }

  if (!endpoint && !model) return null;

  const pickedEndpoint = fromModel
    ? (bindableEndpoints.find((item) => item.id === selectedEndpointId) ?? null)
    : endpoint;
  const snapshotEndpoint = pickedEndpoint;
  const subtitle = fromModel ? `${model?.displayName} · ${model?.slug}` : endpoint?.endpointId;
  const canSubmit = fromModel
    ? bindableEndpoints.length > 0 && Boolean(selectedEndpointId)
    : models.length > 0;

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent
        className={AI_MODEL_SHEET_CLASSNAME}
        style={AI_PROVIDER_BINDING_DRAWER_STYLE}
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>{fromModel ? "新建 Provider 绑定" : "绑定供应商端点"}</SheetTitle>
          <SheetDescription className="font-mono text-[12px] text-slate-500">
            {subtitle}
          </SheetDescription>
        </SheetHeader>
        <form
          id="ai-endpoint-binding-form"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
          onSubmit={onSave}
        >
          {error ? <ErrorBanner message={error} /> : null}
          {/* Pre-fill the fixed side of the binding so both flows post providerEndpointId + canonicalModelId. */}
          {fromModel && model ? (
            <input
              type="hidden"
              name={PROVIDER_BINDING_FIELDS.canonicalModelId.name}
              value={model.id}
            />
          ) : null}
          {!fromModel && endpoint ? (
            <input
              type="hidden"
              name={PROVIDER_BINDING_FIELDS.providerEndpointId.name}
              value={endpoint.id}
            />
          ) : null}
          {snapshotEndpoint ? (
            <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-950">
                  {snapshotEndpoint.displayName ?? snapshotEndpoint.endpointId}
                </span>
                <div className="flex items-center gap-1.5">
                  <AiStatusPill status={snapshotEndpoint.status} />
                  <HealthPill status={snapshotEndpoint.healthStatus} />
                </div>
              </div>
              <p>
                {providerLabel(snapshotEndpoint.provider)} ·{" "}
                {providerLabel(
                  snapshotEndpoint.providerAccount?.provider ?? snapshotEndpoint.provider
                )}
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {fromModel ? (
              <FormField field={PROVIDER_BINDING_FIELDS.providerEndpointId}>
                {(controlProps) => (
                  <NativeSelect
                    {...controlProps}
                    value={selectedEndpointId}
                    onChange={(event) => setSelectedEndpointId(event.currentTarget.value)}
                  >
                    <option value="" disabled>
                      选择供应商端点
                    </option>
                    {bindableEndpoints.map((item) => (
                      <option key={item.id} value={item.id}>
                        {providerLabel(item.provider)} · {item.displayName ?? item.endpointId}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ) : (
              <FormField field={PROVIDER_BINDING_FIELDS.canonicalModelId}>
                {(controlProps) => (
                  <NativeSelect
                    {...controlProps}
                    value={selectedModelId}
                    onChange={(event) => setSelectedModelId(event.currentTarget.value)}
                  >
                    <option value="" disabled>
                      选择模型
                    </option>
                    {models.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName} · {item.slug}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            )}
            <FormField field={PROVIDER_BINDING_FIELDS.status}>
              {(controlProps) => (
                <NativeSelect {...controlProps} defaultValue="draft">
                  <option value="draft">草稿</option>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                  <option value="degraded">降级</option>
                  <option value="archived">归档</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField field={PROVIDER_BINDING_FIELDS.priority} optional>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  defaultValue={100}
                  className="h-9 rounded-lg"
                />
              )}
            </FormField>
            <FormField field={PROVIDER_BINDING_FIELDS.weight} optional>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  defaultValue={100}
                  className="h-9 rounded-lg"
                />
              )}
            </FormField>
          </div>
          <FormField field={PROVIDER_BINDING_FIELDS.disabledReason} optional className="mt-4">
            {(controlProps) => <Textarea {...controlProps} className="min-h-20 rounded-lg" />}
          </FormField>
          <RouteBindingPolicyNotice endpoint={snapshotEndpoint} model={model} className="mt-4" />
        </form>
        <SheetFooter className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" form="ai-endpoint-binding-form" disabled={saving || !canSubmit}>
              {saving ? "保存中…" : "创建绑定"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function BindingPolicyDrawer({
  open,
  binding,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  binding: AdminAiProviderBinding | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!binding) return null;

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent
        className={AI_MODEL_SHEET_CLASSNAME}
        style={AI_PROVIDER_BINDING_DRAWER_STYLE}
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>Provider 路由策略</SheetTitle>
          <SheetDescription className="font-mono text-[12px] text-slate-500">
            {binding.endpointId}
          </SheetDescription>
        </SheetHeader>
        <form
          id="ai-binding-form"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
          onSubmit={onSave}
        >
          {error ? <ErrorBanner message={error} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField field={PROVIDER_BINDING_FIELDS.canonicalModelId}>
              <ReadOnlyValue
                primary={binding.canonicalModel.displayName}
                secondary={binding.canonicalModel.slug}
              />
            </FormField>
            <FormField field={PROVIDER_BINDING_FIELDS.status}>
              {(controlProps) => (
                <NativeSelect {...controlProps} defaultValue={binding.status}>
                  <option value="draft">草稿</option>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                  <option value="degraded">降级</option>
                  <option value="archived">归档</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField field={PROVIDER_BINDING_FIELDS.priority} optional>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  defaultValue={binding.priority}
                  className="h-9 rounded-lg"
                />
              )}
            </FormField>
            <FormField field={PROVIDER_BINDING_FIELDS.weight} optional>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="number"
                  defaultValue={binding.weight}
                  className="h-9 rounded-lg"
                />
              )}
            </FormField>
          </div>
          <FormField field={PROVIDER_BINDING_FIELDS.disabledReason} optional className="mt-4">
            {(controlProps) => (
              <Textarea
                {...controlProps}
                defaultValue={binding.disabledReason ?? ""}
                className="min-h-20 rounded-lg"
              />
            )}
          </FormField>
          <RouteBindingPolicyNotice binding={binding} className="mt-4" />
        </form>
        <SheetFooter className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" form="ai-binding-form" disabled={saving}>
              {saving ? "保存中…" : "保存路由"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function RouteBindingPolicyNotice({
  binding,
  endpoint,
  model,
  className,
}: {
  binding?: AdminAiProviderBinding | null;
  endpoint?: AdminAiProviderEndpoint | null;
  model?: AdminAiCanonicalModel | null;
  className?: string;
}) {
  const provider = binding?.provider ?? endpoint?.provider ?? "";
  const endpointId = binding?.endpointId ?? endpoint?.endpointId ?? "";
  const endpointStatus = binding?.providerEndpoint?.status ?? endpoint?.status ?? "-";
  const healthStatus =
    binding?.providerEndpoint?.healthStatus ?? endpoint?.healthStatus ?? "unknown";
  const canonical = binding?.canonicalModel ?? model;

  return (
    <section className={cn("grid gap-2 md:grid-cols-2 xl:grid-cols-4", className)}>
      <PolicyStat label="运行规则" value="先过滤可用能力，再按 Priority 升序" />
      <PolicyStat label="权重规则" value="同 Priority 下 Weight 越高越优先" />
      <PolicyStat label="绑定范围" value={canonical ? canonical.displayName : "选择统一模型"} />
      <PolicyStat label="Provider" value={provider ? providerLabel(provider) : "选择端点"} />
      <ReadOnlyValue primary={endpointId || "-"} secondary="provider endpoint" />
      <ReadOnlyValue primary={statusLabel(endpointStatus)} secondary="endpoint status" />
      <ReadOnlyValue primary={healthLabel(healthStatus)} secondary="endpoint health" />
      <ReadOnlyValue primary="参数映射由代码 adapter 管理" secondary="DB 不存自由 JSON 映射" />
    </section>
  );
}

function JobDetailDrawer({
  open,
  job,
  detail,
  error,
  onClose,
  onLoad,
}: {
  open: boolean;
  job: AdminAiJobListItem | null;
  detail: AdminAiJobDetail | null;
  error: string | null;
  onClose: () => void;
  onLoad: (jobId: string) => void;
}) {
  useEffect(() => {
    if (open && job?.id && !detail) onLoad(job.id);
  }, [detail, job?.id, onLoad, open]);

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent
        className={AI_MODEL_SHEET_CLASSNAME}
        style={AI_JOB_DETAIL_DRAWER_STYLE}
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle>Request 证据</SheetTitle>
          <SheetDescription className="font-mono text-[12px] text-slate-500">
            FizzDragon job ID · {job?.id ?? "-"}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? <ErrorBanner message={error} /> : null}
          {!detail ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              加载 request 详情…
            </div>
          ) : (
            <div className="space-y-4">
              <JobEvidenceSummary detail={detail} />
              <JobTimelineEvidence detail={detail} />
              <JobPayloadEvidence detail={detail} />
              <JobAttemptsEvidence attempts={detail.attempts} />
              <JobCostLedgerEvidence entries={detail.costLedger} />
              <JobOutputsEvidence outputs={detail.outputs} />
              <JsonBlock title="Raw job detail" value={detail} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function JobEvidenceSummary({ detail }: { detail: AdminAiJobDetail }) {
  const providerCost = latestProviderCost(detail);
  const quotaCost = quotaCostFromRoutingSnapshot(detail.routingSnapshot);
  const profit = grossProfitFromCosts(quotaCost, providerCost);
  const lastAttempt = detail.attempts.at(-1);
  const headerUnits = stringFromRecord(
    asRecord(lastAttempt?.providerResponseHeaders),
    "x-fal-billable-units"
  );
  const runnerId = stringFromRecord(
    asRecord(lastAttempt?.providerResponseHeaders),
    "x-fal-served-from"
  );
  const duration =
    lastAttempt?.runDurationMs != null ? formatDurationMs(lastAttempt.runDurationMs) : "-";
  return (
    <section className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <PolicyStat label="FizzDragon job ID" value={detail.id} />
        <PolicyStat label="Status" value={<JobStatusPill status={detail.status} />} />
        <PolicyStat label="User price" value={quotaCost != null ? `${quotaCost} 积分` : "-"} />
        {providerCost ? (
          <PolicyStat
            label="Provider cost"
            value={formatMoney(providerCost.amount, providerCost.currency)}
          />
        ) : null}
        {profit ? (
          <>
            <PolicyStat label="Gross profit" value={formatProfitUsd(profit.grossProfitUsd)} />
            <PolicyStat label="Gross margin" value={formatPercent(profit.margin)} />
          </>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReadOnlyValue
          primary={detail.canonicalModel?.displayName ?? detail.modelId}
          secondary={detail.modelId}
        />
        <ReadOnlyValue
          primary={detail.providerBinding?.endpointId ?? detail.provider}
          secondary={detail.providerJobId ?? "provider job id -"}
        />
        {headerUnits ? (
          <ReadOnlyValue
            primary={`${headerUnits} billable units`}
            secondary={lastAttempt?.providerRequestId ?? null}
          />
        ) : null}
        <ReadOnlyValue
          primary={
            lastAttempt?.providerStatus != null ? `HTTP ${lastAttempt.providerStatus}` : duration
          }
          secondary={lastAttempt?.providerStatus != null ? duration : "duration"}
        />
        {runnerId ? <ReadOnlyValue primary={runnerId} secondary="x-fal-served-from" /> : null}
      </div>
    </section>
  );
}

function JobTimelineEvidence({ detail }: { detail: AdminAiJobDetail }) {
  const events = timelineEventsForJob(detail);
  if (events.length === 0) return null;
  const startMs = events[0].timeMs;
  const endMs = events.at(-1)?.timeMs ?? startMs;
  const totalMs = Math.max(1, endMs - startMs);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
        Timing
      </div>
      <div className="border-b border-slate-100 px-4 py-4">
        <div className="relative h-12">
          <div className="absolute left-0 right-0 top-5 h-2 rounded-full bg-slate-100" />
          {events.map((event) => {
            const left = `${Math.min(100, Math.max(0, ((event.timeMs - startMs) / totalMs) * 100))}%`;
            return (
              <div
                key={event.key}
                className="absolute top-0 -translate-x-1/2"
                style={{ left }}
                title={`${event.title} · ${event.offset}`}
              >
                <div className={cn("mx-auto h-8 w-1 rounded-full", traceToneClass(event))} />
                <div className="mt-1 w-24 truncate text-center text-[10px] font-medium text-slate-500">
                  {event.offset}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {events.map((event) => (
          <div key={event.key} className="grid gap-3 px-4 py-3 md:grid-cols-[140px_1fr_auto]">
            <div className="font-mono text-[12px] text-slate-500">{event.offset}</div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {event.source} · {event.confidence}
                </span>
              </div>
              {event.description ? (
                <p className="mt-1 text-[12px] leading-5 text-slate-500">{event.description}</p>
              ) : null}
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {event.occurredAt ? formatDate(event.occurredAt) : "-"}
              </p>
            </div>
            <div className="font-mono text-[12px] text-slate-500">
              {event.durationMs != null ? formatDurationMs(event.durationMs) : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function JobPayloadEvidence({ detail }: { detail: AdminAiJobDetail }) {
  const lastAttempt = detail.attempts.at(-1);
  return (
    <div className="space-y-4">
      <JsonBlock
        title="Input"
        value={lastAttempt?.providerRequest ?? detail.normalizedInput ?? detail.input}
      />
      <JsonBlock title="Output" value={lastAttempt?.providerResponse ?? detail.outputs} />
      <JsonBlock title="Logs" value={lastAttempt?.providerLogs ?? detail.logs ?? []} />
      <CodeBlock title="Replay code" value={buildReplaySnippet(detail)} />
    </div>
  );
}

function JobAttemptsEvidence({ attempts }: { attempts: AdminAiJobDetail["attempts"] }) {
  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        暂无 provider attempt。
      </div>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
        Provider attempts
      </div>
      <div className="divide-y divide-slate-200">
        {attempts.map((attempt) => {
          const cost = asRecord(attempt.costAccounting);
          const costUsd = numberFromRecord(cost, "providerCostUsd");
          const billableUnits = numberFromRecord(cost, "billableUnits");
          const hasCostEvidence = costUsd != null || billableUnits != null;
          return (
            <div
              key={attempt.id}
              className={
                hasCostEvidence
                  ? "grid gap-3 px-3 py-3 md:grid-cols-[1fr_1fr_1fr]"
                  : "grid gap-3 px-3 py-3 md:grid-cols-[1fr_1fr]"
              }
            >
              <ReadOnlyValue
                primary={`#${attempt.attemptNumber} · ${attempt.status}`}
                secondary={attempt.providerEndpoint ?? attempt.providerRequestId}
              />
              {hasCostEvidence ? (
                <ReadOnlyValue
                  primary={costUsd != null ? formatMoney(costUsd, "USD") : "Provider cost"}
                  secondary={billableUnits != null ? `${billableUnits} billable units` : null}
                />
              ) : null}
              <ReadOnlyValue
                primary={attempt.runDurationMs != null ? `${attempt.runDurationMs}ms` : "-"}
                secondary={attempt.completedAt ? formatDate(attempt.completedAt) : null}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function JobCostLedgerEvidence({ entries }: { entries: AdminAiJobDetail["costLedger"] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        暂无成本账本记录。
      </div>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
        Cost ledger
      </div>
      <div className="divide-y divide-slate-200">
        {entries.map((entry, index) => (
          <div
            key={entry.id ?? `${entry.entryType}-${index}`}
            className="grid gap-3 px-3 py-3 md:grid-cols-[1fr_1fr_1fr_1fr]"
          >
            <ReadOnlyValue
              primary={entry.provider ?? entry.entryType}
              secondary={entry.endpointId ?? entry.source}
            />
            <ReadOnlyValue
              primary={entry.providerRequestId ?? entry.entryType}
              secondary={entry.source}
            />
            <ReadOnlyValue
              primary={formatMoney(entry.amount, entry.currency)}
              secondary={
                entry.providerCostUsd
                  ? `providerCostUsd ${formatMoney(entry.providerCostUsd, "USD")}`
                  : null
              }
            />
            <ReadOnlyValue
              primary={
                entry.billableUnits != null
                  ? `${entry.billableUnits} ${entry.unit ?? "units"}`
                  : entry.listPriceCredits != null
                    ? `${entry.listPriceCredits} 积分`
                    : "-"
              }
              secondary={
                [
                  entry.unitPrice != null
                    ? `unitPrice ${formatMoney(entry.unitPrice, entry.currency)}`
                    : null,
                  entry.listPriceCredits != null
                    ? `listPrice ${entry.listPriceCredits} 积分`
                    : null,
                  entry.createdAt ? formatDate(entry.createdAt) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function JobOutputsEvidence({ outputs }: { outputs: AdminAiJobDetail["outputs"] }) {
  if (outputs.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
        Outputs
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {outputs.map((output) => (
          <a
            key={output.id}
            href={output.url}
            target="_blank"
            rel="noreferrer"
            className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
          >
            <div className="aspect-square bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- provider outputs can be arbitrary external URLs. */}
              <img src={output.url} alt="" className="size-full object-cover" />
            </div>
            <div className="px-2 py-1.5 font-mono text-[11px] text-slate-500">
              #{output.outputIndex} · {output.type}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500">
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function PolicyStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-[13px] font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ReadOnlyValue({ primary, secondary }: { primary: string; secondary?: string | null }) {
  return (
    <div className="min-h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <p className="truncate text-sm font-medium text-slate-800">{primary}</p>
      {secondary ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{secondary}</p> : null}
    </div>
  );
}

function NativeSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function SupportedModesControl({ value }: { value: unknown }) {
  const selected = new Set(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  );

  return (
    <FormField field={PROVIDER_ENDPOINT_FIELDS.supportedModes} optional>
      {() => (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[12px] font-semibold text-slate-700">支持模式</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PROVIDER_MODE_OPTIONS.map((mode) => (
              <label
                key={mode.value}
                className="flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-2 text-[12px] font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  name={PROVIDER_ENDPOINT_FIELDS.supportedModes.name}
                  value={mode.value}
                  defaultChecked={selected.has(mode.value)}
                  className="size-3.5 rounded border-slate-300 text-slate-950"
                />
                {mode.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </FormField>
  );
}

function NumberInputField({
  field,
  value,
  placeholder,
  min,
  max,
}: {
  field: AdminFieldDefinition;
  value: number | null | undefined;
  placeholder: string;
  min: number;
  max: number;
}) {
  return (
    <FormField field={field} optional>
      {(controlProps) => (
        <Input
          {...controlProps}
          type="number"
          min={min}
          max={max}
          step={1}
          defaultValue={value ?? ""}
          className="h-9 rounded-lg"
          placeholder={placeholder}
        />
      )}
    </FormField>
  );
}

function JsonTextarea({
  field,
  value,
  rows = 7,
  readOnly = false,
}: {
  field: AdminFieldDefinition;
  value: unknown;
  rows?: number;
  readOnly?: boolean;
}) {
  const height = Math.max(168, rows * 20 + 52);

  return (
    <FormField field={field} optional={!readOnly}>
      {(controlProps) => (
        <Textarea
          {...controlProps}
          rows={rows}
          readOnly={readOnly}
          style={{ height }}
          defaultValue={formatJson(value)}
          className={cn(
            "min-h-40 resize-y overflow-auto rounded-lg font-mono text-[12px] leading-5 [field-sizing:fixed]",
            readOnly && "bg-slate-50 text-slate-500"
          )}
        />
      )}
    </FormField>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
        {title}
      </div>
      <pre className="max-h-[560px] overflow-auto bg-slate-950 p-4 text-[12px] leading-5 text-slate-100">
        {formatJson(value)}
      </pre>
    </section>
  );
}

function CodeBlock({ title, value }: { title: string; value: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
        {title}
      </div>
      <pre className="max-h-[420px] overflow-auto bg-slate-950 p-4 text-[12px] leading-5 text-slate-100">
        {value}
      </pre>
    </section>
  );
}

function AiStatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "success"
      : status === "disabled" || status === "degraded" || status === "archived"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{statusLabel(status)}</StatusPill>;
}

function HealthPill({ status }: { status: AdminAiProviderEndpoint["healthStatus"] }) {
  const tone =
    status === "healthy"
      ? "success"
      : status === "degraded" || status === "outage"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{healthLabel(status)}</StatusPill>;
}

function JobStatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "success"
      : status === "failed" || status === "cancelled"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{jobStatusLabel(status)}</StatusPill>;
}

function latestProviderCost(job: Pick<AdminAiJobListItem, "costLedger">) {
  return (job.costLedger ?? []).find((entry) => entry.entryType === "provider_cost") ?? null;
}

function grossProfitFromCosts(
  quotaCost: number | null,
  providerCost: ReturnType<typeof latestProviderCost>
): {
  userPriceUsd: number;
  providerCostUsd: number;
  grossProfitUsd: number;
  margin: number;
} | null {
  if (quotaCost == null || quotaCost <= 0 || !providerCost) return null;
  const providerCostUsd =
    parseFiniteNumber(providerCost.providerCostUsd) ??
    (providerCost.currency.trim().toUpperCase() === "USD"
      ? parseFiniteNumber(providerCost.amount)
      : null);
  if (providerCostUsd == null) return null;
  const userPriceUsd = quotaCost * COMPUTE_POINT_USD;
  const grossProfitUsd = userPriceUsd - providerCostUsd;
  return {
    userPriceUsd,
    providerCostUsd,
    grossProfitUsd,
    margin: grossProfitUsd / userPriceUsd,
  };
}

type TimelineEvent = {
  key: string;
  title: string;
  description?: string | null;
  source: string;
  confidence: string;
  occurredAt: string;
  timeMs: number;
  offset: string;
  durationMs?: number | null;
  eventType: string;
};

type TimelineRawEvent = {
  id?: string;
  eventType: string;
  title?: string | null;
  description?: string | null;
  source: string;
  confidence: string;
  occurredAt: string;
  durationMs?: number | null;
};

function timelineEventsForJob(detail: AdminAiJobDetail): TimelineEvent[] {
  const rawEvents: TimelineRawEvent[] =
    detail.traceEvents?.length > 0 ? detail.traceEvents : fallbackTraceEvents(detail);
  const parsed: TimelineEvent[] = [];
  rawEvents.forEach((event, index) => {
    const timeMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(timeMs)) return;
    parsed.push({
      key: event.id ?? `${event.eventType}-${index}`,
      title: event.title || traceEventLabel(event.eventType),
      description: event.description,
      source: event.source,
      confidence: event.confidence,
      occurredAt: event.occurredAt,
      timeMs,
      offset: "0.000s",
      durationMs: event.durationMs,
      eventType: event.eventType,
    });
  });
  parsed.sort((a, b) => a.timeMs - b.timeMs);
  const startMs = parsed[0]?.timeMs ?? 0;
  return parsed.map((event) => ({
    ...event,
    offset: formatDurationMs(event.timeMs - startMs),
  }));
}

function fallbackTraceEvents(detail: AdminAiJobDetail): TimelineRawEvent[] {
  const points = [
    ["job_submitted", "Submitted", detail.createdAt],
    ["worker_started", "Worker started", detail.startedAt],
    ["provider_submitted", "Provider submitted", detail.providerSubmittedAt],
    ["provider_execution_started", "Execution started", detail.providerStartedAt],
    ["provider_execution_finished", "Execution finished", detail.providerCompletedAt],
    [
      "job_completed",
      detail.status === "failed" ? "Job failed" : "Job completed",
      detail.completedAt,
    ],
  ] as const;
  return points
    .filter(([, , occurredAt]) => Boolean(occurredAt))
    .map(([eventType, title, occurredAt], index) => ({
      id: `fallback-${eventType}-${index}`,
      eventType,
      title,
      source: "internal",
      confidence: "observed",
      occurredAt: occurredAt as string,
      description: null,
      durationMs: null,
    }));
}

function traceToneClass(event: TimelineEvent) {
  if (event.eventType.includes("failed") || event.eventType.includes("error")) return "bg-rose-500";
  if (event.source === "provider_platform") return "bg-violet-500";
  if (event.source === "provider_header") return "bg-amber-500";
  return "bg-slate-700";
}

function traceEventLabel(eventType: string) {
  return eventType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(3)}s`;
}

function buildReplaySnippet(detail: AdminAiJobDetail): string {
  const lastAttempt = detail.attempts.at(-1);
  const endpoint = lastAttempt?.providerEndpoint ?? detail.deployment;
  const input = lastAttempt?.providerRequest ?? detail.normalizedInput ?? detail.input ?? {};
  if (detail.provider === "replicate") {
    return [
      'import Replicate from "replicate";',
      "",
      "const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });",
      `const prediction = await replicate.predictions.create({`,
      `  model: ${JSON.stringify(endpoint)},`,
      `  input: ${formatJson(asRecord(input).input ?? input).replaceAll("\n", "\n  ")},`,
      "});",
      "",
      "console.log(prediction.id);",
      "console.log(prediction.output);",
    ].join("\n");
  }

  if (detail.provider === "byteplus-modelark") {
    return [
      "const response = await fetch(",
      '  `${process.env.BYTEPLUS_MODELARK_API_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3"}/images/generations`,',
      "  {",
      '    method: "POST",',
      "    headers: {",
      "      Authorization: `Bearer ${process.env.BYTEPLUS_MODELARK_API_KEY}`,",
      '      "Content-Type": "application/json",',
      "    },",
      `    body: JSON.stringify(${formatJson(input).replaceAll("\n", "\n    ")}),`,
      "  },",
      ");",
      "",
      "console.log(await response.json());",
    ].join("\n");
  }

  return [
    'import { fal } from "@fal-ai/client";',
    "",
    `const result = await fal.subscribe(${JSON.stringify(endpoint)}, {`,
    `  input: ${formatJson(input).replaceAll("\n", "\n  ")},`,
    "  logs: true,",
    "  onQueueUpdate: (update) => {",
    '    if (update.status === "IN_PROGRESS") {',
    "      update.logs?.map((log) => log.message).forEach(console.log);",
    "    }",
    "  },",
    "});",
    "",
    "console.log(result.data);",
    "console.log(result.requestId);",
  ].join("\n");
}

function quotaCostFromRoutingSnapshot(value: unknown): number | null {
  const snapshot = asRecord(value);
  const policy = asRecord(snapshot.policy);
  const quota = asRecord(policy.quota);
  return numberFromRecord(quota, "cost");
}

function formatMoney(value: unknown, currency: string | null | undefined): string {
  const amount = typeof value === "number" ? value : Number(value);
  const code = currency?.trim().toUpperCase() || "USD";
  if (!Number.isFinite(amount)) return `${String(value)} ${code}`;
  if (code === "USD") {
    return `$${amount.toFixed(Math.abs(amount) < 0.01 ? 6 : 2)}`;
  }
  return `${amount.toFixed(6)} ${code}`;
}

function formatProfitUsd(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `$${value.toFixed(Math.abs(value) < 1 ? 6 : 2)}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function parseFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  return parseFiniteNumber(record[key]);
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function computeReadiness(
  providers: AdminAiProviderAccount[],
  bindings: AdminAiProviderBinding[],
  models: AdminAiCanonicalModel[]
) {
  const activeProviders = providers.filter((item) => item.status === "active").length;
  const activeBindings = bindings.filter((item) => item.status === "active").length;
  const activeModels = models.filter((item) => item.status === "active").length;
  const risks: Array<{ message: string; model?: AdminAiCanonicalModel }> = [];

  if (activeProviders === 0)
    risks.push({ message: "没有启用的 provider 账号，前台提交会缺少可用资源。" });
  if (activeBindings === 0)
    risks.push({ message: "没有启用的 provider binding，统一模型无法路由到真实 endpoint。" });
  if (activeModels === 0) risks.push({ message: "没有启用的统一模型，前台模型选择无法闭环。" });

  for (const model of models.filter(
    (item) => item.status === "active" && item.bindingCount === 0
  )) {
    risks.push({
      message: `统一模型「${model.displayName}」已启用但没有启用 provider 绑定。`,
      model,
    });
  }

  return { activeProviders, activeBindings, activeModels, risks };
}

function defaultModelDraft(): AdminAiCanonicalModel {
  return {
    id: "",
    slug: "gpt-image-2",
    displayName: "GPT Image 2",
    modality: "image",
    family: "gpt-image",
    generationModes: ["text_to_image"],
    status: "draft",
    description: "",
    parameterPolicy: {},
    outputPolicy: {},
    entitlementPolicy: {},
    billingPolicy: { mode: "charge", unit: "compute_point", finalCostSource: "product_pricing" },
    queuePolicy: { priorityTier: "standard", maxConcurrentPerUser: 2, timeoutMs: 150000 },
    uiPolicy: {},
    observabilityPolicy: {
      providerTrace: true,
      requestPayloads: true,
      costLedger: true,
      alertAfterMs: 75000,
    },
    metadata: {},
    updatedAt: "",
    bindingCount: 0,
    jobCount: 0,
    priceBand: null,
  };
}

function defaultProviderEndpointDraft(
  providers: AdminAiProviderAccount[]
): AdminAiProviderEndpoint {
  const providerAccount = providers[0];
  return {
    id: "",
    providerAccountId: providerAccount?.id ?? "",
    provider: providerAccount?.provider ?? "fal-ai",
    endpointId: "",
    displayName: "",
    modality: "image",
    status: "draft",
    healthStatus: "unknown",
    supportedModes: ["text_to_image"],
    providerInputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    providerOutputSchema: {
      type: "object",
      properties: {},
    },
    maxConcurrentRequests: null,
    maxRequestsPerMinute: null,
    requestTimeoutSeconds: null,
    cooldownSeconds: null,
    failureThreshold: null,
    catalogSnapshot: {},
    disabledReason: null,
    updatedAt: "",
    providerAccount: providerAccount
      ? {
          id: providerAccount.id,
          provider: providerAccount.provider,
        }
      : undefined,
    bindingCount: 0,
  };
}

function buildProviderAccountPayload(form: FormData) {
  return {
    status: requiredString(form, PROVIDER_ACCOUNT_FIELDS.status),
    rateLimitPolicy: jsonObjectField(form, PROVIDER_ACCOUNT_FIELDS.rateLimitPolicy),
    quotaPolicy: jsonObjectField(form, PROVIDER_ACCOUNT_FIELDS.quotaPolicy),
  };
}

function buildModelPayload(form: FormData) {
  return {
    displayName: requiredString(form, MODEL_POLICY_FIELDS.displayName),
    family: requiredString(form, MODEL_POLICY_FIELDS.family),
    status: requiredString(form, MODEL_POLICY_FIELDS.status),
    description: nullableString(form, MODEL_POLICY_FIELDS.description),
    generationModes: jsonArrayField(form, MODEL_POLICY_FIELDS.generationModes),
    parameterPolicy: jsonObjectField(form, MODEL_POLICY_FIELDS.parameterPolicy),
    billingPolicy: jsonObjectField(form, MODEL_POLICY_FIELDS.billingPolicy),
    queuePolicy: jsonObjectField(form, MODEL_POLICY_FIELDS.queuePolicy),
    entitlementPolicy: jsonObjectField(form, MODEL_POLICY_FIELDS.entitlementPolicy),
    observabilityPolicy: jsonObjectField(form, MODEL_POLICY_FIELDS.observabilityPolicy),
    uiPolicy: jsonObjectField(form, MODEL_POLICY_FIELDS.uiPolicy),
    metadata: jsonObjectField(form, MODEL_POLICY_FIELDS.metadata),
  };
}

function buildCreateModelPayload(form: FormData) {
  return {
    slug: requiredString(form, MODEL_POLICY_FIELDS.slug),
    modality: requiredString(form, MODEL_POLICY_FIELDS.modality),
    ...buildModelPayload(form),
  };
}

function buildProviderEndpointPayload(form: FormData) {
  return {
    displayName: requiredString(form, PROVIDER_ENDPOINT_FIELDS.displayName),
    status: requiredString(form, PROVIDER_ENDPOINT_FIELDS.status),
    healthStatus: requiredString(form, PROVIDER_ENDPOINT_FIELDS.healthStatus),
    supportedModes: stringArrayField(form, PROVIDER_ENDPOINT_FIELDS.supportedModes),
    providerInputSchema: jsonObjectField(form, PROVIDER_ENDPOINT_FIELDS.providerInputSchema),
    providerOutputSchema: jsonObjectField(form, PROVIDER_ENDPOINT_FIELDS.providerOutputSchema),
    maxConcurrentRequests: nullableIntegerField(
      form,
      PROVIDER_ENDPOINT_FIELDS.maxConcurrentRequests
    ),
    maxRequestsPerMinute: nullableIntegerField(form, PROVIDER_ENDPOINT_FIELDS.maxRequestsPerMinute),
    requestTimeoutSeconds: nullableIntegerField(
      form,
      PROVIDER_ENDPOINT_FIELDS.requestTimeoutSeconds
    ),
    cooldownSeconds: nullableIntegerField(form, PROVIDER_ENDPOINT_FIELDS.cooldownSeconds),
    failureThreshold: nullableIntegerField(form, PROVIDER_ENDPOINT_FIELDS.failureThreshold),
    catalogSnapshot: jsonObjectField(form, PROVIDER_ENDPOINT_FIELDS.catalogSnapshot),
    disabledReason: nullableString(form, PROVIDER_ENDPOINT_FIELDS.disabledReason),
  };
}

function buildCreateProviderEndpointPayload(form: FormData) {
  return {
    providerAccountId: requiredString(form, PROVIDER_ENDPOINT_FIELDS.providerAccountId),
    endpointId: requiredString(form, PROVIDER_ENDPOINT_FIELDS.endpointId),
    modality: requiredString(form, PROVIDER_ENDPOINT_FIELDS.modality),
    ...buildProviderEndpointPayload(form),
  };
}

function buildProviderBindingPayload(form: FormData) {
  return {
    status: requiredString(form, PROVIDER_BINDING_FIELDS.status),
    priority: integerField(form, PROVIDER_BINDING_FIELDS.priority, 100),
    weight: integerField(form, PROVIDER_BINDING_FIELDS.weight, 100),
    disabledReason: nullableString(form, PROVIDER_BINDING_FIELDS.disabledReason),
  };
}

function buildCreateProviderBindingPayload(form: FormData) {
  return {
    providerEndpointId: requiredString(form, PROVIDER_BINDING_FIELDS.providerEndpointId),
    canonicalModelId: requiredString(form, PROVIDER_BINDING_FIELDS.canonicalModelId),
    ...buildProviderBindingPayload(form),
  };
}

function requiredString(form: FormData, field: AdminFieldDefinition) {
  const value = stringField(form, field);
  if (!value) throw new Error(`${field.label}不能为空。`);
  return value;
}

function nullableString(form: FormData, field: AdminFieldDefinition) {
  return stringField(form, field) || null;
}

function stringField(form: FormData, field: AdminFieldDefinition) {
  const value = form.get(field.name);
  return typeof value === "string" ? value.trim() : "";
}

function integerField(form: FormData, field: AdminFieldDefinition, fallback: number) {
  const value = Number.parseInt(stringField(form, field), 10);
  return Number.isFinite(value) ? value : fallback;
}

function nullableIntegerField(form: FormData, field: AdminFieldDefinition) {
  const raw = stringField(form, field);
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

function stringArrayField(form: FormData, field: AdminFieldDefinition) {
  return form
    .getAll(field.name)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonObjectField(form: FormData, field: AdminFieldDefinition): JsonObject {
  const value = parseJsonField(form, field);
  if (!value) return {};
  if (!isPlainObject(value)) throw new Error(`${field.label}必须是 JSON object。`);
  return value;
}

function jsonArrayField(form: FormData, field: AdminFieldDefinition): string[] {
  const value = parseJsonField(form, field);
  if (!value) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field.label}必须是 string[] JSON。`);
  }
  return value;
}

function parseJsonField(form: FormData, field: AdminFieldDefinition) {
  const raw = stringField(form, field);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${field.label}不是有效 JSON。`);
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatJson(value: unknown) {
  if (value === undefined || value === null || value === "") return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function statusLabel(status: string) {
  return (
    {
      draft: "草稿",
      active: "启用",
      disabled: "停用",
      degraded: "降级",
      archived: "归档",
    }[status] ?? status
  );
}

function healthLabel(status: string) {
  return (
    {
      unknown: "未知",
      healthy: "健康",
      degraded: "降级",
      outage: "故障",
    }[status] ?? status
  );
}

function jobStatusLabel(status: string) {
  return (
    {
      created: "已创建",
      in_queue: "排队",
      in_progress: "运行",
      completed: "完成",
      failed: "失败",
      cancelled: "取消",
      expired: "过期",
    }[status] ?? status
  );
}

function modePreview(supportedModes: unknown) {
  const modes = Array.isArray(supportedModes)
    ? supportedModes.filter((item): item is string => typeof item === "string")
    : [];
  return modes.join(" / ") || "未声明能力";
}
