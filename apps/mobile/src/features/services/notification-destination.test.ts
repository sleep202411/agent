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

it("opens exact private case and feedback links natively without dropping additional context", () => {
  for (const [source, path] of [
    ["/crews/cases", "/private-cases"],
    [`/zh-HK/crews/cases/${task}`, `/private-cases?caseId=${task}`],
    ["/crews/feedback/", "/task-feedback"],
  ])
    expect(notificationDestination(notification(source!), "global", "en-US")).toEqual({
      kind: "native",
      path,
    });
  for (const path of [
    `/crews/cases/${task}?event=2`,
    `/crews/cases/${task}#evidence`,
    "/crews/cases/not-a-uuid",
    "/crews/feedback?task=x",
  ])
    expect(notificationDestination(notification(path), "global", "en-US")).toEqual({
      kind: "web",
      path,
    });
});
it("opens the case carried by an official dispute task-update notification", () => {
  const source = `/crews/${crew}/workspace?tab=tasks&task=${task}`,
    caseId = "33333333-3333-4333-8333-333333333333";
  const item = {
    ...notification(source),
    type: "crew.task.updated",
    meta: { deeplink: source, crewId: crew, taskId: task, disputeId: caseId },
  };
  expect(notificationDestination(item, "global", "en-US")).toEqual({
    kind: "native",
    path: `/private-cases?caseId=${caseId}`,
  });
  for (const patch of [{ crewId: "other" }, { taskId: crew }, { disputeId: "bad" }])
    expect(
      notificationDestination({ ...item, meta: { ...item.meta, ...patch } }, "global", "en-US")
    ).toEqual({ kind: "native", path: `/crew-tasks/${crew}?task=${task}` });
  expect(
    notificationDestination({ ...item, type: "crew.task.assigned" }, "global", "en-US")
  ).toEqual({ kind: "native", path: `/crew-tasks/${crew}?task=${task}` });
  const withComment = source + "&comment=keep";
  expect(
    notificationDestination(
      { ...item, meta: { ...item.meta, deeplink: withComment } },
      "global",
      "en-US"
    )
  ).toEqual({ kind: "web", path: withComment });
});
it.each(["global", "cn"] as const)("opens exact Story canvas links in %s", (region) => {
  expect(
    notificationDestination(
      notification(`/zh-HK/story-studio/projects/${task}/canvas`),
      region,
      "zh-HK"
    )
  ).toEqual({ kind: "native", path: `/agent/${task}/assets?graph=1` });
  const origin = region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
  for (const path of [
    `/story-studio/projects/${task}/canvas?node=selected`,
    `/story-studio/projects/${task}/canvas#comment`,
    "/story-studio/projects/invalid/canvas",
  ])
    expect(notificationDestination(notification(path), region, "en-US")).toEqual({
      kind: "studio",
      url: `${origin}/en-US${path}`,
    });
});

it("opens a project-only membership link without guessing a workspace", () => {
  expect(notificationDestination(notification(`/project/${task}`), "global", "en-US")).toEqual({
    kind: "native",
    path: `/studio-project?projectId=${task}`,
  });
  for (const path of [
    `/project/${task}?section=keep`,
    `/project/${task}#comment`,
    "/project/invalid",
  ])
    expect(notificationDestination(notification(path), "cn", "zh-CN")).toEqual({
      kind: "studio",
      url: `https://studio.fizzspace.cn/zh-CN${path}`,
    });
});

it.each(["cn", "global"] as const)(
  "opens exact workspace invitations in %s without dropping other intent",
  (region) => {
    expect(
      notificationDestination(notification(`/zh-CN/canvas?ws=${crew}`), region, "zh-CN")
    ).toEqual({ kind: "native", path: `/studio-projects?workspaceId=${crew}` });
    const origin =
      region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
    for (const path of [
      "/canvas",
      "/canvas?ws=bad",
      `/canvas?ws=${crew}&ws=${crew}`,
      `/canvas?ws=${crew}&prompt=keep`,
      `/canvas?ws=${crew}#details`,
    ])
      expect(notificationDestination(notification(path), region, "en-US")).toEqual({
        kind: "studio",
        url: `${origin}/en-US${path}`,
      });
  }
);
