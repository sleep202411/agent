import { useQuery, useQueries } from "@tanstack/react-query";
import { backendApi, type Paginated } from "@/src/lib/api";

// ============ Types ============

export interface V1World {
  id: string;
  name: string;
  bannerLink: string;
}

export interface V1WorldProduct {
  id: string;
  name: string;
  imagePath: string;
  description: string | null;
  worldId: string;
}

/** 世界 + 其下所有项目 */
export interface WorldGroup {
  world: V1World;
  products: V1WorldProduct[];
}

// ============ Query Keys ============

export const worldKeys = {
  all: ["v1", "worlds"] as const,
  list: (type: WorldListType) => [...worldKeys.all, type] as const,
  products: (worldId: string) => ["v1", "world-products", worldId] as const,
};

// ============ API Functions ============

type WorldListType = "own" | "created";

const WORLD_LIST_URLS: Record<WorldListType, string> = {
  own: "/user/world/query/world/ownproject",
  created: "/user/world/query/myworld",
};

async function fetchWorldList(type: WorldListType) {
  return backendApi.post<Paginated<V1World>>(WORLD_LIST_URLS[type], {
    data: { page: 1, pageSize: 100 },
  });
}

async function fetchWorldProducts(worldId: string) {
  return backendApi.post<Paginated<V1WorldProduct>>("/api/user/world/list/worldproduct", {
    data: { page: 1, pageSize: 100, worldId },
  });
}

// ============ Hooks ============

/**
 * 获取用户所有世界及其下项目，按世界分组。
 *
 * 流程：
 * 1. 拉取世界列表（默认"我参与的"，包含创建和参与）
 * 2. 对每个世界并行拉取 worldproduct 列表
 * 3. 组合为 WorldGroup[]，过滤掉无项目的空世界
 */
export function useWorldsWithProducts(type: WorldListType = "own") {
  const worldsQuery = useQuery({
    queryKey: worldKeys.list(type),
    queryFn: () => fetchWorldList(type),
  });

  const worlds = worldsQuery.data?.list ?? [];

  const productQueries = useQueries({
    queries: worlds.map((world) => ({
      queryKey: worldKeys.products(world.id),
      queryFn: () => fetchWorldProducts(world.id),
    })),
  });

  const isProductsLoading = productQueries.length > 0 && productQueries.some((q) => q.isLoading);

  const groups: WorldGroup[] = worlds.reduce<WorldGroup[]>((acc, world, i) => {
    const products = productQueries[i]?.data?.list ?? [];
    if (products.length > 0) {
      acc.push({ world, products });
    }
    return acc;
  }, []);

  return {
    /** 按世界分组的项目列表（已过滤空世界） */
    groups,
    /** 原始世界列表 */
    worlds,
    /** 所有项目的总数 */
    totalProducts: groups.reduce((sum, g) => sum + g.products.length, 0),
    isLoading: worldsQuery.isLoading || isProductsLoading,
    isError: worldsQuery.isError || productQueries.some((q) => q.isError),
    error: worldsQuery.error,
  };
}
