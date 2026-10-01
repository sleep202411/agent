import { expect, it } from "vitest";
import { notificationDestination } from "./notification-destination";
const crew = "11111111-1111-4111-8111-111111111111",
  task = "22222222-2222-4222-8222-222222222222";
const notification = (deeplink: string) => ({
  id: "n",
  type: "crew.task.assigned",
  title: "Task",
  body: "",
  meta: { deeplink },
  createdAt: "2026-10-01T00:00:00Z",
  readAt: null,
});
it("opens the exact native Crew task, including localized Web links", () => {
  expect(
    notificationDestination(
      notification(`/zh-CN/crews/${crew}/workspace?tab=tasks&task=${task}`),
      "global",
      "en-US"
    )
  ).toEqual({ kind: "native", path: `/crew-tasks/${crew}?task=${task}` });
});
it("preserves unsupported task subviews and invitations as Web routes", () => {
  for (const path of [
    `/crews/${crew}/workspace?tab=tasks&task=${task}&comment=c`,
    `/crew-invitations/invitation-id`,
  ])
    expect(notificationDestination(notification(path), "global", "en-US")).toEqual({
      kind: "web",
      path,
    });
});
it.each([
  "https://evil.test",
  "//evil.test",
  "/%2Fexample.test",
  "/foo%5Cbar",
  "/foo%0abar",
  "/%zz",
  "javascript:alert(1)",
])("rejects unsafe destination %s", (path) => {
  expect(notificationDestination(notification(path), "global", "en-US")).toBeNull();
});
it("resolves Studio using the build region and locale, not the API origin", () => {
  expect(notificationDestination(notification("/project/project-id"), "cn", "zh-HK")).toEqual({
    kind: "studio",
    url: "https://studio.fizzspace.cn/zh-HK/project/project-id",
  });
});
it.each(["cn", "global"] as const)("uses native Studio invitation acceptance in %s", (region) => {
  const token = "a".repeat(32),
    origin = region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
  expect(notificationDestination(notification(`/zh-HK/invite/${token}`), region, "zh-HK")).toEqual({
    kind: "native",
    path: `/studio-invite?link=${encodeURIComponent(`${origin}/invite/${token}`)}`,
  });
  expect(
    notificationDestination(
      notification(`/invite/${token}?redirect=https://evil.test`),
      region,
      "en-US"
    )
  ).toBeNull();
});
it("maps exact income, members and Crew-list destinations without losing subview parameters", () => {
  expect(
    notificationDestination(notification(`/crews/${crew}/workspace?tab=income`), "global", "en-US")
  ).toEqual({ kind: "native", path: `/crew-finance/${crew}` });
  expect(
    notificationDestination(notification(`/crews/${crew}/workspace?tab=members`), "global", "en-US")
  ).toEqual({ kind: "native", path: `/crew-tasks/${crew}?section=members` });
  expect(notificationDestination(notification("/crews"), "global", "en-US")).toEqual({
    kind: "native",
    path: "/crews",
  });
  const path = `/crews/${crew}/workspace?tab=members&agreement=agreement-id`;
  expect(notificationDestination(notification(path), "global", "en-US")).toEqual({
    kind: "web",
    path,
  });
});
it("supports real short Crew IDs and opens an exact native agreement", () => {
  const shortCrew = "imrAnlXZxyG9";
  expect(
    notificationDestination(
      notification(`/crews/${shortCrew}/workspace?tab=tasks&task=${task}`),
      "global",
      "en-US"
    )
  ).toEqual({ kind: "native", path: `/crew-tasks/${shortCrew}?task=${task}` });
  expect(
    notificationDestination(
      notification(`/crews/${shortCrew}/workspace?tab=members&agreement=${task}`),
      "global",
      "en-US"
    )
  ).toEqual({ kind: "native", path: `/crew-agreements/${shortCrew}?agreement=${task}` });
});
it("opens recipient invitations separately from invitation management", () => {
  expect(
    notificationDestination(notification(`/crew-invitations/${task}`), "global", "en-US")
  ).toEqual({ kind: "native", path: `/crew-invitation-response/${task}` });
  const path = `/crew-invitations/${task}?extra=1`;
  expect(notificationDestination(notification(path), "global", "en-US")).toEqual({
    kind: "web",
    path,
  });
});

it("resolves Crew chat links and preserves the exact mentioned conversation", () => {
  const n = notification(`/crews/${crew}/workspace?tab=chat`);
  expect(notificationDestination(n, "global", "en-US")).toEqual({
    kind: "native",
    path: `/crew-chat/${crew}?channel=team`,
  });
  const mention = {
    ...n,
    type: "crew.chat.mentioned",
    meta: { ...n.meta, crewId: crew, conversationId: task },
  };
  expect(notificationDestination(mention, "global", "en-US")).toEqual({
    kind: "native",
    path: `/conversation/${task}`,
  });
  expect(
    notificationDestination(
      { ...mention, meta: { ...mention.meta, crewId: "other" } },
      "global",
      "en-US"
    )
  ).toEqual({ kind: "native", path: `/crew-chat/${crew}?channel=team` });
  const path = `/crews/${crew}/workspace?tab=chat&message=123`;
  expect(notificationDestination(notification(path), "global", "en-US")).toEqual({
    kind: "web",
    path,
  });
});
