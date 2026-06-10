/**
 * "Mine" tab data — the signed-in user's own works. Personal works come from
 * the Java content service (POST /vedio/query/mypersonal, form-encoded). My IPs
 * and my crews live in ip-api / crew-api (Nest /aurora).
 */
import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";

export interface MyWork {
  id: string;
  title: string;
  coverUrl?: string;
  /** Backend review state: 0 = under review, 3 = rejected, 5 = approved. */
  reviewStatus?: number;
  /** True when the work is private (viewStatus != "1"). */
  isPrivate: boolean;
}

type WorkDto = {
  id?: string | number;
  title?: string;
  videoBanner?: string;
  review?: number;
  viewStatus?: string;
};

type WorksResponse =
  | WorkDto[]
  | {
      list?: WorkDto[];
      records?: WorkDto[];
      data?: WorkDto[] | { list?: WorkDto[]; records?: WorkDto[] };
    };

function extractList(res: WorksResponse): WorkDto[] {
  if (Array.isArray(res)) return res;
  if (res.list) return res.list;
  if (res.records) return res.records;
  const data = res.data;
  if (Array.isArray(data)) return data;
  return data?.list ?? data?.records ?? [];
}

export async function fetchMyWorks(): Promise<MyWork[]> {
  try {
    const res = await api.postForm<WorksResponse>("/vedio/query/mypersonal", {
      page: "1",
      pageSize: "30",
    });
    return extractList(res)
      .filter((work) => work.id != null)
      .map((work) => ({
        id: String(work.id),
        title: work.title ?? "",
        coverUrl: work.videoBanner
          ? resolveAssetUrl(work.videoBanner, appEnv.assets.bannerBaseUrl)
          : undefined,
        reviewStatus: work.review,
        isPrivate: work.viewStatus != null && work.viewStatus !== "1",
      }));
  } catch {
    return [];
  }
}
