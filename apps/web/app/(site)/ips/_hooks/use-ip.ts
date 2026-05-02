/**
 * IP feature data layer — public re-export surface.
 *
 * Routes / components import from `_hooks/use-ip` and never need to
 * know which file in this folder a given hook lives in. See sibling
 * files for implementation:
 *
 *   - `shared.ts`         — header helpers, `ipKeys`, image URL helpers
 *   - `types.ts`          — public types (IPProject / Episode / FAQ / …)
 *   - `use-ip-list.ts`    — Plaza listing + taxonomy (legacy + new)
 *   - `use-ip-detail.ts`  — IP detail reads + project mutations
 *   - `use-episodes.ts`   — episode CRUD (P0)
 *   - `use-members.ts`    — team member read + add/remove
 *   - `use-faqs.ts`       — FAQ CRUD (P1)
 *   - `use-plaza.ts`      — Plaza homepage Featured + For You (P1)
 */

export {
  ipKeys,
  ipImageUrl,
  userAvatarUrl,
  splitTags,
  avatarFallbackTone,
  hashId,
  legacyProjectEditUrl,
} from "./shared";
export { useProjectEditUrl } from "./use-project-edit-url";
export type {
  IPProject,
  IPListResult,
  IPType,
  IPTag,
  CategoryMap,
  Episode,
  VideoMeta,
  CreateEpisodeInput,
  UpdateEpisodeInput,
  FAQ,
  FeaturedSlide,
  RailItem,
  Project,
  ProjectMember,
  ProjectJob,
} from "./types";

export { useIPList, useIPTypes, useIPTagList } from "./use-ip-list";

export {
  useProjectDetail,
  useProjectVideoLink,
  useProjectJobs,
  useLegacyJobsByRole,
  useUpdateProject,
  useUploadProjectVideo,
} from "./use-ip-detail";

export {
  useProjectEpisodes,
  useEpisodeVideoLink,
  useCreateEpisode,
  useUpdateEpisode,
  useDeleteEpisode,
  useReorderEpisode,
} from "./use-episodes";

export { useProjectMembers, useAddMember, useRemoveMember, MEMBER_ROLE } from "./use-members";
export type { MemberRole } from "./use-members";
export { useUserByEmail } from "./use-user-search";
export type { UserLookupRow } from "./use-user-search";
export { useProjectRoles } from "./use-roles";
export type { ProjectRole } from "./use-roles";

export { useFAQs, useCreateFAQ, useUpdateFAQ, useDeleteFAQ } from "./use-faqs";

export { usePlazaFeatured, usePlazaForYou } from "./use-plaza";

export { useSparkAnalyze, useSparkGenerateBanner, SPARK_MAX_BYTES } from "./use-spark";
export type { SparkDraft } from "./use-spark";
