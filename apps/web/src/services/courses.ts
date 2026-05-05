// 课程相关接口
import { api, ApiRequestError } from "@/src/lib/api";

// ─── Types ────────────────────────────────────────────
/**
 * 单个课程
 */
export interface Course {
  id: number; // 课程ID
  number: number; // 章节内序号
  type: string; // 章节名称，如 "一、叙事工程与剧本重构（上）"
  title: string; // 课程标题
  info: string; // 课程简介
  url: string | null; // 视频链接，"free"=免费，其他=付费
  picLink: string; // 封面图片
  status: number; // 状态码
  createTime: string; // 创建时间
  updateTime: string; // 更新时间
  optId: number; // 操作者ID
  lan: string; // 语言，如 "cn"
  vedioLink: string; // 视频文件路径
}
/**
 * 课程列表（按章节分组）
 * key: "0" = 平台教程, "1" = 大师课
 */
export interface CourseChapters {
  [chapterKey: string]: Course[];
}

// TODO: Restore play count / rating response types after the backend endpoints are available.
// export interface CoursePlayCountResponse {
//   playCount?: number;
//   count?: number;
//   views?: number;
// }
//
// export interface CourseRatingResponse {
//   rating?: number;
//   score?: number;
//   averageScore?: number;
//   ratingCount?: number;
// }

export function isCourseApiError(error: unknown, code: number, message?: string) {
  if (!(error instanceof ApiRequestError)) return false;

  const normalizeMessage = (value: string) =>
    value
      .trim()
      .replace(/\s+([!?！？，,.;:])/g, "$1")
      .replace(/\s+/g, " ");

  // Check HTTP status for HTTP_* error codes (e.g., "HTTP_403")
  if (typeof error.code === "string" && error.code.startsWith("HTTP_")) {
    const httpStatus = Number(error.code.replace("HTTP_", ""));
    if (httpStatus === code) {
      return message === undefined || normalizeMessage(error.message) === normalizeMessage(message);
    }
    return false;
  }

  const matchesCode = String(error.code) === String(code);
  const matchesMessage =
    message === undefined || normalizeMessage(error.message) === normalizeMessage(message);
  return matchesCode && matchesMessage;
}

// ─── API ──────────────────────────────────────────────
/** 获取课程列表 */
export const getCourseList = () => api.get<CourseChapters>("/project/list/course/type/title");

/** 获取课程播放链接 */
export const getCourseVideoLink = (id: number) =>
  api.postForm<string>("/project/play/course/getLink", { id: String(id) });

// TODO: Restore these calls after the backend provides play count / rating endpoints.
// export const incrementCourseVideoPlayCount = (id: number) =>
//   api.postForm<CoursePlayCountResponse>("/project/play/course/addPlayCount", {
//     id: String(id),
//   });
//
// export const submitCourseRating = (id: number, score: number) =>
//   api.postForm<CourseRatingResponse>("/project/play/course/score", {
//     id: String(id),
//     score: String(score),
//   });
