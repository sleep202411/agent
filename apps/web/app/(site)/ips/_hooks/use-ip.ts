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

export { ipKeys, ipImageUrl, userAvatarUrl } from "./shared";
export type {
  IPProject,
  IPListResult,
  IPType,
  IPTag,
  CategoryMap,
  TagListResponse,
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

export {
  useIPProjects,
  useIPList,
  useIPCategories,
  useIPTags,
  useIPTypes,
  useIPTagList,
} from "./use-ip-list";

export {
  useProjectDetail,
  useProjectVideoLink,
  useProjectJobs,
  useUpdateProject,
  useUploadProjectVideo,
} from "./use-ip-detail";

export {
  useProjectEpisodes,
  useCreateEpisode,
  useUpdateEpisode,
  useDeleteEpisode,
  useReorderEpisode,
} from "./use-episodes";

export { useProjectMembers, useAddMember, useRemoveMember } from "./use-members";

export { useFAQs, useCreateFAQ, useUpdateFAQ, useDeleteFAQ } from "./use-faqs";

export { usePlazaFeatured, usePlazaForYou } from "./use-plaza";
