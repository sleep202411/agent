/**
 * Frontend-only preview data for the first asset-center UI pass.
 *
 * This file is intentionally isolated from hooks and API contracts. The
 * production asset model will replace it once the folder / asset endpoints
 * land; keeping it here prevents temporary design data from becoming an
 * accidental backend contract.
 */

export type CrewAssetKind = "folder" | "pdf" | "image" | "video" | "audio" | "design" | "doc";

export interface CrewAssetPreviewItem {
  id: string;
  kind: CrewAssetKind;
  name: string;
  typeLabelKey: string;
  taskLabelKey: string;
  contributor: string;
  contributorSeed: string;
  modifiedAt: string;
  size: string;
  version?: string;
  thumbnail?: string;
  favorite?: boolean;
}

export interface CrewAssetFolderNode {
  id: string;
  labelKey: string;
  children?: CrewAssetFolderNode[];
}

export const CREW_ASSET_FOLDER_TREE: CrewAssetFolderNode[] = [
  {
    id: "crew-assets",
    labelKey: "folderCrewAssets",
    children: [
      {
        id: "episode-01",
        labelKey: "folderEpisode01",
        children: [
          { id: "script-storyboard", labelKey: "folderScriptStoryboard" },
          { id: "concept", labelKey: "folderConcept" },
          { id: "shooting", labelKey: "folderShooting" },
          { id: "post", labelKey: "folderPost" },
          { id: "final", labelKey: "folderFinal" },
        ],
      },
      { id: "episode-02", labelKey: "folderEpisode02" },
      { id: "shared", labelKey: "folderShared" },
    ],
  },
];

export const CREW_ASSET_PREVIEW_ITEMS: CrewAssetPreviewItem[] = [
  {
    id: "folder-working",
    kind: "folder",
    name: "folderWorking",
    typeLabelKey: "typeFolder",
    taskLabelKey: "taskStoryboard",
    contributor: "Lin Mo",
    contributorSeed: "crew-assets-lin-mo",
    modifiedAt: "2026-07-28 09:30",
    size: "—",
  },
  {
    id: "folder-reference",
    kind: "folder",
    name: "folderReference",
    typeLabelKey: "typeFolder",
    taskLabelKey: "taskStoryboard",
    contributor: "Zhang Xiaobei",
    contributorSeed: "crew-assets-zhang-xiaobei",
    modifiedAt: "2026-07-28 09:21",
    size: "—",
    favorite: true,
  },
  {
    id: "folder-submissions",
    kind: "folder",
    name: "folderSubmissions",
    typeLabelKey: "typeFolder",
    taskLabelKey: "taskStoryboard",
    contributor: "Chen Hang",
    contributorSeed: "crew-assets-chen-hang",
    modifiedAt: "2026-07-27 18:42",
    size: "—",
  },
  {
    id: "folder-deliverables",
    kind: "folder",
    name: "folderDeliverables",
    typeLabelKey: "typeFolder",
    taskLabelKey: "taskDelivery",
    contributor: "Zhao Jian",
    contributorSeed: "crew-assets-zhao-jian",
    modifiedAt: "2026-07-27 16:05",
    size: "—",
  },
  {
    id: "storyboard-v03",
    kind: "pdf",
    name: "EP01_Scrt_010_board_v03.pdf",
    typeLabelKey: "typePdf",
    taskLabelKey: "taskStoryboard",
    contributor: "Zhang Xiaobei",
    contributorSeed: "crew-assets-zhang-xiaobei",
    modifiedAt: "2026-07-28 09:14",
    size: "12.6 MB",
    version: "v3",
    thumbnail: "/crew-assets/storyboard-sheet.png",
    favorite: true,
  },
  {
    id: "storyboard-v02",
    kind: "pdf",
    name: "EP01_Scrt_010_board_v02.pdf",
    typeLabelKey: "typePdf",
    taskLabelKey: "taskStoryboard",
    contributor: "Zhang Xiaobei",
    contributorSeed: "crew-assets-zhang-xiaobei",
    modifiedAt: "2026-07-27 21:11",
    size: "11.8 MB",
    version: "v2",
    thumbnail: "/crew-assets/storyboard-sheet.png",
  },
  {
    id: "shot-reference",
    kind: "image",
    name: "EP01_S01_Shot01_reference.jpg",
    typeLabelKey: "typeImage",
    taskLabelKey: "taskStoryboard",
    contributor: "Lin Mo",
    contributorSeed: "crew-assets-lin-mo",
    modifiedAt: "2026-07-27 18:09",
    size: "2.8 MB",
    version: "v1",
    thumbnail: "/jinling-rumeng/production/p00/continuity/sc01-entry-first-16x9-v01.png",
  },
  {
    id: "concept-psd",
    kind: "design",
    name: "EP01_Character_Main_v05.psd",
    typeLabelKey: "typeDesign",
    taskLabelKey: "taskConcept",
    contributor: "Lin Mo",
    contributorSeed: "crew-assets-lin-mo",
    modifiedAt: "2026-07-27 15:32",
    size: "312.7 MB",
    version: "v5",
    thumbnail: "/jinling-rumeng/preview/story/sc07-baoyu.png",
  },
  {
    id: "animatic",
    kind: "video",
    name: "EP01_Animatic_v03.mp4",
    typeLabelKey: "typeVideo",
    taskLabelKey: "taskStoryboard",
    contributor: "Chen Hang",
    contributorSeed: "crew-assets-chen-hang",
    modifiedAt: "2026-07-27 17:56",
    size: "1.2 GB",
    version: "v3",
    thumbnail: "/narrative-demo/videos/plot-a-enter-elite-school.jpg",
  },
  {
    id: "bgm",
    kind: "audio",
    name: "EP01_BGM_tension_01.wav",
    typeLabelKey: "typeAudio",
    taskLabelKey: "taskPost",
    contributor: "Zhao Jian",
    contributorSeed: "crew-assets-zhao-jian",
    modifiedAt: "2026-07-27 15:22",
    size: "18.6 MB",
    version: "v1",
  },
  {
    id: "brief",
    kind: "doc",
    name: "EP01_storyboard_brief.docx",
    typeLabelKey: "typeDocument",
    taskLabelKey: "taskStoryboard",
    contributor: "Wang Yan",
    contributorSeed: "crew-assets-wang-yan",
    modifiedAt: "2026-07-27 11:28",
    size: "1.1 MB",
    version: "v2",
  },
];

export const CREW_ASSET_PERMISSION_GROUPS = [
  {
    id: "manage",
    labelKey: "permissionManage",
    descriptionKey: "permissionManageDescription",
    members: ["Zhang Xiaobei", "Lin Mo", "Chen Hang", "Zhao Jian"],
  },
  {
    id: "edit",
    labelKey: "permissionEdit",
    descriptionKey: "permissionEditDescription",
    members: ["Lin Mo", "Chen Hang", "Wang Yan", "Zhang Xiaobei", "Zhao Jian", "Liu Ning"],
  },
  {
    id: "upload",
    labelKey: "permissionUpload",
    descriptionKey: "permissionUploadDescription",
    members: ["Wang Yan", "Liu Ning"],
  },
  {
    id: "view",
    labelKey: "permissionView",
    descriptionKey: "permissionViewDescription",
    members: ["Zhang Xiaobei", "Lin Mo"],
  },
] as const;
