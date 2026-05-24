import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, api } from "@/src/lib/api";
import { ipKeys } from "./shared";

type PriceType = 1 | 2;

export interface PointPriceRule {
  id: string;
  priceType: PriceType;
  targetId: string;
  points: number;
  enabled: boolean;
  raw: Record<string, unknown>;
}

export interface IpPricing {
  freeEpisodeIds: string[];
  defaultPriceIntegral: number;
  /** Project-level package price, stored as priceType=1,targetId=projectId. */
  bundleIntegral?: number;
  overrides: Record<string, number>;
  projectRule?: PointPriceRule;
  episodeRules: Record<string, PointPriceRule>;
}

interface SaveRuleInput {
  priceType: PriceType;
  targetId: string;
  points: number;
  existingRule?: PointPriceRule;
}

interface DeleteRuleInput {
  ruleId: string;
}

const PROJECT_PRICE_TYPE = 1 satisfies PriceType;
const EPISODE_PRICE_TYPE = 2 satisfies PriceType;
const EPISODE_FETCH_CONCURRENCY = 6;

function pricingQueryKey(ipId: string, episodeIds: readonly string[] = []) {
  return [...ipKeys.pricing(ipId), episodeIds.join(",")] as const;
}

export function useIpPricing(ipId: string, episodeIds: readonly string[] = []) {
  return useQuery<IpPricing>({
    queryKey: pricingQueryKey(ipId, episodeIds),
    queryFn: () => fetchIpPricing(ipId, episodeIds),
    enabled: !!ipId,
  });
}

export function useSavePointPriceRule(ipId: string, episodeIds: readonly string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: savePointPriceRule,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ipKeys.pricing(ipId) });
      await qc.invalidateQueries({ queryKey: pricingQueryKey(ipId, episodeIds) });
    },
  });
}

export function useDeletePointPriceRule(ipId: string, episodeIds: readonly string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePointPriceRule,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ipKeys.pricing(ipId) });
      await qc.invalidateQueries({ queryKey: pricingQueryKey(ipId, episodeIds) });
    },
  });
}

async function fetchIpPricing(ipId: string, episodeIds: readonly string[]): Promise<IpPricing> {
  const projectRule = await fetchPointPriceRule(PROJECT_PRICE_TYPE, ipId);
  const episodeRules = await fetchEpisodeRules(episodeIds);

  const overrides = Object.fromEntries(
    Object.entries(episodeRules)
      .filter(([, rule]) => rule.enabled)
      .map(([episodeId, rule]) => [episodeId, rule.points])
  );
  const freeEpisodeIds = Object.entries(episodeRules)
    .filter(([, rule]) => rule.enabled && rule.points <= 0)
    .map(([episodeId]) => episodeId);

  return {
    freeEpisodeIds,
    defaultPriceIntegral: 0,
    bundleIntegral: projectRule?.enabled && projectRule.points > 0 ? projectRule.points : undefined,
    overrides,
    projectRule: projectRule ?? undefined,
    episodeRules,
  };
}

async function fetchEpisodeRules(episodeIds: readonly string[]) {
  const rules: Record<string, PointPriceRule> = {};

  for (let i = 0; i < episodeIds.length; i += EPISODE_FETCH_CONCURRENCY) {
    const batch = episodeIds.slice(i, i + EPISODE_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((episodeId) => fetchPointPriceRule(EPISODE_PRICE_TYPE, episodeId))
    );
    results.forEach((rule, index) => {
      if (rule) {
        rules[batch[index]!] = rule;
      }
    });
  }

  return rules;
}

async function fetchPointPriceRule(
  priceType: PriceType,
  targetId: string
): Promise<PointPriceRule | null> {
  try {
    const raw = await api.get<unknown>("/project/point/price/get", {
      params: { priceType, targetId },
    });
    return normalizeRule(raw, priceType, targetId);
  } catch (error) {
    if (isMissingRule(error)) return null;
    throw error;
  }
}

async function savePointPriceRule(input: SaveRuleInput): Promise<PointPriceRule | null> {
  const points = Math.max(0, Math.floor(input.points));
  const payload = buildRulePayload(input.priceType, input.targetId, points, input.existingRule?.id);
  const raw = input.existingRule?.id
    ? await api.put<unknown>("/project/point/price/update", { data: payload })
    : await api.post<unknown>("/project/point/price/add", { data: payload });
  return normalizeRule(raw, input.priceType, input.targetId);
}

async function deletePointPriceRule(input: DeleteRuleInput): Promise<void> {
  await api.delete(`/project/point/price/delete/${encodeURIComponent(input.ruleId)}`);
}

function buildRulePayload(priceType: PriceType, targetId: string, points: number, id?: string) {
  return {
    ...(id ? { id } : {}),
    integralPrice: points,
    priceType,
    remark: "",
    status: 1,
    // Keep this as a string: these ids are 18-digit int64 values and
    // would lose precision if coerced to a JavaScript number.
    targetId,
  };
}

function normalizeRule(
  raw: unknown,
  fallbackPriceType: PriceType,
  fallbackTargetId: string
): PointPriceRule | null {
  const rec = firstRecord(raw);
  if (!rec) return null;

  const id = firstString(rec, ["id", "priceId", "ruleId", "priceRuleId", "pointPriceId"]);
  const points = firstNumber(rec, [
    "integralPrice",
    "points",
    "point",
    "price",
    "integral",
    "priceIntegral",
    "score",
    "value",
    "amount",
  ]);

  if (points == null) return null;

  return {
    id,
    priceType: normalizePriceType(rec.priceType, fallbackPriceType),
    targetId: firstString(rec, ["targetId", "projectId", "episodeId"]) || fallbackTargetId,
    points: Math.max(0, Math.floor(points)),
    enabled: normalizeEnabled(rec),
    raw: rec,
  };
}

function firstRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return firstRecord(raw[0]);
  if (typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;

  for (const key of ["data", "info", "record", "price", "rule"]) {
    const nested = rec[key];
    if (nested && typeof nested === "object") {
      return firstRecord(nested);
    }
  }

  return rec;
}

function firstString(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = rec[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function firstNumber(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = rec[key];
    if (value === undefined || value === null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizePriceType(value: unknown, fallback: PriceType): PriceType {
  return Number(value) === EPISODE_PRICE_TYPE ? EPISODE_PRICE_TYPE : fallback;
}

function normalizeEnabled(rec: Record<string, unknown>): boolean {
  for (const key of ["enabled", "enable", "isEnabled", "active", "isActive"]) {
    if (typeof rec[key] === "boolean") return rec[key] as boolean;
  }

  const status = rec.status ?? rec.state;
  if (status === undefined || status === null || status === "") return true;
  if (typeof status === "boolean") return status;
  if (typeof status === "number") return status !== 0;

  const text = String(status).toLowerCase();
  return !["0", "false", "disabled", "disable", "off", "inactive"].includes(text);
}

function isMissingRule(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.status === 404 || error.code === 404 || error.code === "404") return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("no data") ||
    message.includes("empty") ||
    message.includes("不存在") ||
    message.includes("未找到") ||
    message.includes("暂无")
  );
}
