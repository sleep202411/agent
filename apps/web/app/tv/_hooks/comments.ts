import { api } from "@/src/lib/api";
export interface TvComment {
  id: string;
  ipId: string;
  userId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}
export interface CommentPage {
  items: TvComment[];
  nextCursor: string | null;
}
const path = (ipId: string) => `/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/comments`;
export const commentsApi = {
  list: (ipId: string, signal: AbortSignal, cursor?: string) =>
    api.get<CommentPage>(path(ipId), { signal, params: { cursor }, raw: true }),
  create: (ipId: string, body: string, requestId: string, signal: AbortSignal) =>
    api.post<TvComment>(path(ipId), { signal, data: { body, requestId }, raw: true }),
  remove: (ipId: string, id: string, signal: AbortSignal) =>
    api.delete(`${path(ipId)}/${encodeURIComponent(id)}`, { signal, raw: true }),
};
