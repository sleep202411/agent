/**
 * API Client exports
 *
 * Single unified client for all backend calls:
 * - Java backend: backendApi.post("/api/user/...", { data })
 * - Nest.js backend: backendApi.post("/aurora/api/...", { data })
 *
 * Both go through Next.js rewrites for same-origin proxy.
 */

export { api as backendApi, ApiRequestError } from "./api-client";
export type { ApiResponse, ApiPaginated, ApiRequestConfig } from "./api-client";

// Convenience aliases
export { api } from "./api-client";
export type { ApiPaginated as Paginated } from "./api-client";
export type { Asset } from "@/src/store/slices/projectSlice";

// No-op placeholder for future interceptors
export function setupInterceptors() {}
