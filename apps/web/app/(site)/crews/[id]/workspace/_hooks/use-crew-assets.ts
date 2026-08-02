"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";

export type CrewAssetSource = "all" | "recent" | "favorites" | "trash";
export type CrewAssetSort = "modified" | "name" | "size";
export type CrewAssetAccessMode = "inherit" | "restricted";
export type CrewAssetPermission = "view" | "upload" | "edit" | "manage";

export interface CrewAssetNodeDTO {
  id: string;
  parentId: string | null;
  name: string;
  kind: "folder" | "file";
  status: "active" | "trashed";
  accessMode: CrewAssetAccessMode;
  permissionVersion: number;
  effectivePermission: CrewAssetPermission;
  favorite: boolean;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  media: {
    id: string;
    kind: "image" | "video" | "audio" | "document" | "other";
    contentType: string;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    previewUrl: string;
  } | null;
}

interface CrewAssetListResponse {
  items: CrewAssetNodeDTO[];
  parentId: string | null;
  source: CrewAssetSource;
  nextCursor: string | null;
}

interface AssetListQuery {
  parentId?: string;
  source: CrewAssetSource;
  query?: string;
  kind?: "folder" | "file";
  sort: CrewAssetSort;
}

export interface CrewAssetFolderDTO {
  id: string;
  parentId: string | null;
  name: string;
  effectivePermission: CrewAssetPermission;
}

export interface CrewAssetLocationDTO {
  node: CrewAssetNodeDTO;
  path: Array<{ id: string; name: string }>;
}

export interface CrewAssetContextDTO {
  cell: "com" | "cn" | "global";
  provider: "s3_compatible" | "aliyun_oss";
  storageAvailable: boolean;
  maxUploadBytes: number;
  accessModel: "hierarchical_acl";
  role: "admin" | "finance" | "member";
  capabilities: {
    view: boolean;
    createFolder: boolean;
    upload: boolean;
    organize: boolean;
    trash: boolean;
    restore: boolean;
    deleteForever: boolean;
  };
}

export function useCrewAssetContext(crewId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.assetContext(crewId),
    enabled: enabled && Boolean(crewId),
    queryFn: () =>
      crewApi.get<CrewAssetContextDTO>(`/crews/${encodeURIComponent(crewId)}/assets/context`),
    retry: false,
    staleTime: 30_000,
  });
}

export function useCrewAssets(crewId: string, query: AssetListQuery, enabled: boolean) {
  const wireQuery = {
    parentId: query.parentId,
    source: query.source,
    query: query.query,
    kind: query.kind,
    sort: query.sort,
  };
  const result = useInfiniteQuery({
    queryKey: crewKeys.assetList(crewId, wireQuery),
    enabled: enabled && Boolean(crewId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewAssetListResponse>(`/crews/${encodeURIComponent(crewId)}/assets`, {
        query: {
          ...wireQuery,
          cursor: pageParam,
          limit: 100,
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
  });
  const flattened = result.data
    ? {
        items: result.data.pages.flatMap((page) => page.items),
        parentId: result.data.pages[0]?.parentId ?? null,
        source: result.data.pages[0]?.source ?? query.source,
        nextCursor: result.data.pages.at(-1)?.nextCursor ?? null,
      }
    : undefined;
  return { ...result, data: flattened };
}

export function useCrewAssetFolders(crewId: string, enabled = true) {
  return useQuery({
    queryKey: [...crewKeys.assets(crewId), "folders"],
    enabled: enabled && Boolean(crewId),
    queryFn: () =>
      crewApi.get<CrewAssetFolderDTO[]>(`/crews/${encodeURIComponent(crewId)}/assets/folders`),
    retry: false,
  });
}

export function useCrewAssetLocation(crewId: string, nodeId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...crewKeys.assets(crewId), "node", nodeId],
    enabled: enabled && Boolean(crewId) && Boolean(nodeId),
    queryFn: () =>
      crewApi.get<CrewAssetLocationDTO>(
        `/crews/${encodeURIComponent(crewId)}/assets/nodes/${encodeURIComponent(nodeId!)}`
      ),
    retry: false,
  });
}

export interface CrewAssetGrantDTO {
  id: string;
  userId: string;
  permission: CrewAssetPermission;
  grantedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewAssetPermissionsDTO {
  accessMode: CrewAssetAccessMode;
  permissionVersion: number;
  effectivePermission: CrewAssetPermission;
  canManage: boolean;
  grants: CrewAssetGrantDTO[];
}

export interface CrewAssetPermissionEventDTO {
  id: string;
  crewId: string;
  nodeId: string;
  actorUserId: string;
  action: "permissions_updated";
  previousMode: CrewAssetAccessMode;
  nextMode: CrewAssetAccessMode;
  previousVersion: number;
  nextVersion: number;
  previousGrants: Array<{
    userId: string;
    permission: CrewAssetPermission;
  }>;
  nextGrants: Array<{
    userId: string;
    permission: CrewAssetPermission;
  }>;
  createdAt: string;
}

export function useCrewAssetPermissions(crewId: string, nodeId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...crewKeys.assets(crewId), "permissions", nodeId],
    enabled: enabled && Boolean(crewId) && Boolean(nodeId),
    queryFn: () =>
      crewApi.get<CrewAssetPermissionsDTO>(
        `/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId!)}/permissions`
      ),
    retry: false,
  });
}

export function useCrewAssetPermissionEvents(
  crewId: string,
  nodeId: string | null,
  enabled = true
) {
  return useQuery({
    queryKey: [...crewKeys.assets(crewId), "permissions", nodeId, "events"],
    enabled: enabled && Boolean(crewId) && Boolean(nodeId),
    queryFn: () =>
      crewApi.get<CrewAssetPermissionEventDTO[]>(
        `/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId!)}/permissions/events`
      ),
    retry: false,
  });
}

function useAssetMutation<TInput, TOutput>(
  crewId: string,
  mutationFn: (input: TInput) => Promise<TOutput>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: crewKeys.assets(crewId) });
    },
  });
}

export function useCreateCrewAssetFolder(crewId: string) {
  return useAssetMutation<{ name: string; parentId: string | null }, CrewAssetNodeDTO>(
    crewId,
    (input) =>
      crewApi.post(`/crews/${encodeURIComponent(crewId)}/assets/folders`, {
        body: input,
      })
  );
}

export interface AttachCrewAssetFileInput {
  name: string;
  parentId: string | null;
  mediaAssetId: string;
}

export function attachCrewAssetFile(
  crewId: string,
  input: AttachCrewAssetFileInput
): Promise<CrewAssetNodeDTO> {
  return crewApi.post(`/crews/${encodeURIComponent(crewId)}/assets/files`, {
    body: input,
  });
}

export function useAttachCrewAssetFile(crewId: string) {
  return useAssetMutation<AttachCrewAssetFileInput, CrewAssetNodeDTO>(crewId, (input) =>
    attachCrewAssetFile(crewId, input)
  );
}

export function discardPendingCrewAssetUpload(crewId: string, mediaAssetId: string): Promise<void> {
  return crewApi.delete(
    `/crews/${encodeURIComponent(crewId)}/assets/uploads/${encodeURIComponent(mediaAssetId)}`,
    { keepalive: true }
  );
}

export function useUpdateCrewAsset(crewId: string) {
  return useAssetMutation<
    {
      nodeId: string;
      expectedUpdatedAt: string;
      name?: string;
      parentId?: string | null;
    },
    CrewAssetNodeDTO
  >(crewId, ({ nodeId, ...body }) =>
    crewApi.patch(`/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId)}`, {
      body,
    })
  );
}

export function useTrashCrewAsset(crewId: string) {
  return useAssetMutation<string, void>(crewId, (nodeId) =>
    crewApi.delete(`/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId)}`)
  );
}

export function useRestoreCrewAsset(crewId: string) {
  return useAssetMutation<string, CrewAssetNodeDTO>(crewId, (nodeId) =>
    crewApi.post(
      `/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId)}/restore`
    )
  );
}

export function usePermanentlyDeleteCrewAsset(crewId: string) {
  return useAssetMutation<string, void>(crewId, (nodeId) =>
    crewApi.delete(
      `/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId)}/permanent`
    )
  );
}

export function useSetCrewAssetFavorite(crewId: string) {
  return useAssetMutation<{ nodeId: string; favorite: boolean }, { favorite: boolean }>(
    crewId,
    ({ nodeId, favorite }) =>
      crewApi.put(
        `/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId)}/favorite`,
        { body: { favorite } }
      )
  );
}

export function useSetCrewAssetPermissions(crewId: string) {
  return useAssetMutation<
    {
      nodeId: string;
      accessMode: CrewAssetAccessMode;
      expectedVersion: number;
      grants: Array<{ userId: string; permission: CrewAssetPermission }>;
    },
    CrewAssetPermissionsDTO
  >(crewId, ({ nodeId, ...body }) =>
    crewApi.put(
      `/crews/${encodeURIComponent(crewId)}/assets/${encodeURIComponent(nodeId)}/permissions`,
      { body }
    )
  );
}
