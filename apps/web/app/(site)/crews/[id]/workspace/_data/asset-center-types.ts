export type CrewAssetKind = "folder" | "pdf" | "image" | "video" | "audio" | "design" | "doc";

export interface CrewAssetPreviewItem {
  contractLocked?: boolean;
  id: string;
  parentId?: string | null;
  kind: CrewAssetKind;
  name: string;
  typeLabelKey: string;
  contributor: string;
  contributorSeed: string;
  updatedAt: string;
  modifiedAt: string;
  size: string;
  thumbnail?: string;
  mediaUrl?: string;
  contentType?: string;
  favorite?: boolean;
  accessMode: "inherit" | "restricted";
  permissionVersion: number;
  effectivePermission: "view" | "upload" | "edit" | "manage";
  linkedStudio?: {
    mediaAssetId: string;
    projectId: string | null;
    storyProjectId: string | null;
    previewUrl: string;
  } | null;
}
