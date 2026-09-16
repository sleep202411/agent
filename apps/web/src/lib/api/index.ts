/**
 * API Client exports
 *
 * Client for Java-style success envelopes, including compatible Nest endpoints:
 * - Java backend: backendApi.post("/api/user/...", { data })
 * - Compatible Nest endpoint: backendApi.post("/aurora/viewer-assistance", { data })
 *
 * Requests use the Next.js same-origin routes. Plain-JSON Nest endpoints need
 * their scoped transport; raw mode still requires a success envelope marker.
 */

export { api as backendApi, ApiRequestError } from "./api-client";
export type { ApiResponse, ApiPaginated, ApiRequestConfig } from "./api-client";

// Convenience aliases
export {
  api,
  getApiWorkspaceId,
  notifyUnauthorized,
  setApiWorkspaceId,
  setUnauthorizedHandler,
} from "./api-client";
export type { ApiPaginated as Paginated } from "./api-client";
export type { Asset } from "@/src/store/slices/projectSlice";

// No-op placeholder for future interceptors
export function setupInterceptors() {}
