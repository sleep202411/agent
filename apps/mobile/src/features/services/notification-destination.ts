import { notificationTarget, type NotificationDTO } from "@repo/shared/notifications";
import { studioInviteRoute } from "../agent/studio-invite-link";
import { z } from "zod";
const uuid = z.string().uuid();
export function notificationDestination(
  notification: NotificationDTO,
  region: "cn" | "global",
  locale: string
) {
  const target = notificationTarget(notification);
  if (!target) return null;
  let url: URL;
  try {
    const decoded = decodeURIComponent(target.path.split(/[?#]/, 1)[0]!);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return null;
    url = new URL(target.path, "https://notification.invalid");
    if (url.origin !== "https://notification.invalid") return null;
  } catch {
    return null;
  }
  if (target.surface === "web" && /^\/crews\/?$/.test(url.pathname) && !url.search && !url.hash)
    return { kind: "native" as const, path: "/crews" };
  const match = /^\/crews\/([^/]+)\/workspace\/?$/.exec(url.pathname);
  if (
    target.surface === "web" &&
    match &&
    uuid.safeParse(match[1]).success &&
    url.searchParams.get("tab") === "tasks" &&
    url.searchParams.getAll("tab").length === 1 &&
    url.searchParams.getAll("task").length === 1 &&
    uuid.safeParse(url.searchParams.get("task")).success &&
    [...url.searchParams.keys()].every((key) => key === "tab" || key === "task") &&
    !url.hash
  ) {
    return {
      kind: "native" as const,
      path: `/crew-tasks/${match[1]}?task=${url.searchParams.get("task")}`,
    };
  }
  if (
    target.surface === "web" &&
    match &&
    uuid.safeParse(match[1]).success &&
    !url.hash &&
    url.searchParams.getAll("tab").length === 1 &&
    [...url.searchParams.keys()].every((key) => key === "tab")
  ) {
    if (url.searchParams.get("tab") === "income")
      return { kind: "native" as const, path: `/crew-finance/${match[1]}` };
    if (url.searchParams.get("tab") === "members")
      return { kind: "native" as const, path: `/crew-tasks/${match[1]}?section=members` };
  }
  if (target.surface === "studio") {
    const origin =
      region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
    if (url.pathname.startsWith("/invite/")) {
      try {
        return {
          kind: "native" as const,
          path: studioInviteRoute(`${origin}${target.path}`, region),
        };
      } catch {
        return null;
      }
    }
    const language = ["en-US", "zh-CN", "zh-HK"].includes(locale) ? locale : "en-US";
    return { kind: "studio" as const, url: `${origin}/${language}${target.path}` };
  }
  return { kind: "web" as const, path: target.path };
}
