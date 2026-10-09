import { z } from "zod";
import { appEnv, resolveAssetUrl } from "@/config";
import { api, ApiRequestError } from "@/lib/api-client";

import type { CreatorServiceDetail, CreatorServicePackage, CreatorServiceSummary } from "./types";

type CreatorServiceCardDto = {
  id?: string | null;
  creatorId?: string | number | null;
  title?: string | null;
  summary?: string | null;
  coverPath?: string | null;
  category?: string | null;
  tags?: string[] | null;
  publishedAt?: string | null;
  startingPrice?: number | null;
  currency?: string | null;
  startingDeliveryDays?: number | null;
  packageCount?: number | null;
};

type CreatorServicePackageDto = {
  id?: string | null;
  tier?: string | null;
  title?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  deliveryDays?: number | null;
  revisions?: number | null;
  scope?: string[] | null;
};

type CreatorServiceQuestionDto = {
  id?: string | null;
  prompt?: string | null;
  helpText?: string | null;
  required?: boolean | null;
};

type CreatorServiceDetailDto = CreatorServiceCardDto & {
  version?: number;
  packages?: CreatorServicePackageDto[] | null;
  requirementQuestions?: CreatorServiceQuestionDto[] | null;
  status?: string | null;
  updatedAt?: string | null;
};

type CreatorServiceListResponse = {
  items?: CreatorServiceCardDto[];
  nextCursor?: string | null;
};

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mapService(dto: CreatorServiceCardDto): CreatorServiceSummary | undefined {
  const id = nonEmpty(dto.id);
  const creatorId = dto.creatorId == null ? undefined : String(dto.creatorId);
  const title = nonEmpty(dto.title);
  if (!id || !creatorId || !title) return undefined;
  const coverPath = nonEmpty(dto.coverPath);

  return {
    id,
    creatorId,
    title,
    summary: nonEmpty(dto.summary) ?? "",
    coverUrl: coverPath ? resolveAssetUrl(coverPath, appEnv.assets.bannerBaseUrl) : undefined,
    category: nonEmpty(dto.category) ?? "other",
    tags: (dto.tags ?? []).filter((tag): tag is string => typeof tag === "string" && !!tag.trim()),
    startingPrice: typeof dto.startingPrice === "number" ? dto.startingPrice : 0,
    currency: nonEmpty(dto.currency) ?? "USD",
    startingDeliveryDays:
      typeof dto.startingDeliveryDays === "number" ? dto.startingDeliveryDays : 0,
    packageCount: typeof dto.packageCount === "number" ? dto.packageCount : 0,
    publishedAt: nonEmpty(dto.publishedAt) ?? "",
  };
}

function mapPackage(dto: CreatorServicePackageDto): CreatorServicePackage | undefined {
  const id = nonEmpty(dto.id);
  const title = nonEmpty(dto.title);
  const tier = nonEmpty(dto.tier);
  const currency = nonEmpty(dto.currency);
  if (
    !id ||
    !title ||
    !tier ||
    !["basic", "standard", "premium"].includes(tier) ||
    !currency ||
    typeof dto.price !== "number" ||
    !Number.isFinite(dto.price) ||
    dto.price < 0
  )
    return undefined;
  return {
    id,
    tier,
    title,
    description: nonEmpty(dto.description) ?? "",
    price: dto.price,
    currency,
    deliveryDays: typeof dto.deliveryDays === "number" ? dto.deliveryDays : 0,
    revisions: typeof dto.revisions === "number" ? dto.revisions : 0,
    scope: (dto.scope ?? []).filter((item): item is string => typeof item === "string" && !!item),
  };
}

function mapDetail(dto: CreatorServiceDetailDto): CreatorServiceDetail | undefined {
  const summary = mapService(dto);
  if (!summary) return undefined;
  const packages = (dto.packages ?? [])
    .map(mapPackage)
    .filter((pkg): pkg is CreatorServicePackage => !!pkg);
  if (
    packages.length !== (dto.packages ?? []).length ||
    new Set(packages.map((p) => p.tier)).size !== packages.length
  ) {
    throw new Error("Invalid service packages; reload before editing");
  }
  const cheapest = packages.reduce<CreatorServicePackage | undefined>(
    (current, pkg) => (!current || pkg.price < current.price ? pkg : current),
    undefined
  );

  return {
    ...summary,
    version:
      Number.isSafeInteger(dto.version) && Number(dto.version) >= 0 ? dto.version : undefined,
    packages,
    startingPrice: cheapest?.price ?? summary.startingPrice,
    currency: cheapest?.currency ?? summary.currency,
    startingDeliveryDays: cheapest?.deliveryDays ?? summary.startingDeliveryDays,
    packageCount: packages.length || summary.packageCount,
    requirementQuestions: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          prompt: z.string().trim().min(1).max(240),
          helpText: z
            .string()
            .max(240)
            .nullish()
            .transform((value) => value ?? ""),
          required: z.boolean(),
        })
      )
      .max(20)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Duplicate question IDs"
      )
      .parse(dto.requirementQuestions ?? []),
    status: nonEmpty(dto.status) ?? "listed",
    updatedAt: nonEmpty(dto.updatedAt) ?? "",
  };
}

export async function fetchCreatorServices(
  limit = 12,
  params: { creatorId?: string } = {}
): Promise<CreatorServiceSummary[]> {
  try {
    const res = await api.get<CreatorServiceListResponse>("/creator-services", {
      service: "aurora",
      params: { limit, creatorId: params.creatorId },
    });
    const seen = new Set<string>();
    return (res.items ?? []).map(mapService).filter((service): service is CreatorServiceSummary => {
      if (!service || seen.has(service.id)) return false;
      seen.add(service.id);
      return true;
    });
  } catch {
    return [];
  }
}

export async function fetchCreatorServiceById(
  id: string,
  signal?: AbortSignal
): Promise<CreatorServiceDetail | undefined> {
  try {
    const res = await api.get<CreatorServiceDetailDto>(
      `/creator-services/${encodeURIComponent(id)}`,
      {
        service: "aurora",
        signal,
      }
    );
    return mapDetail(res);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return undefined;
    throw error;
  }
}
