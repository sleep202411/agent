import { beforeEach, expect, it, vi } from "vitest";
import { getAdminSession } from "./admin-session";
import { POST as createNews } from "@/app/api/admin/news/route";
import { NextRequest } from "next/server";
import { createAdminNews } from "./admin-news";
vi.mock("./admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("./admin-news", () => ({ createAdminNews: vi.fn().mockResolvedValue("created") }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
import * as news0 from "@/app/api/admin/news/[id]/route";
import * as news1 from "@/app/api/admin/news/route";
import * as news2 from "@/app/api/admin/news/tags/[tagId]/route";
import * as news3 from "@/app/api/admin/news/tags/route";
import * as courses0 from "@/app/api/admin/courses/[id]/publish/route";
import * as courses1 from "@/app/api/admin/courses/[id]/route";
import * as courses2 from "@/app/api/admin/courses/route";
import * as courses3 from "@/app/api/admin/courses/upload/cover/route";
import * as courses4 from "@/app/api/admin/courses/upload/video/route";
import * as courses5 from "@/app/api/admin/courses/upload/video-url/route";
const routes = [
  {
    name: "app/api/admin/news/[id]/route.ts PUT",
    permission: "news.write",
    run: () =>
      news0.PUT(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof news0.PUT>)
      ),
  },
  {
    name: "app/api/admin/news/[id]/route.ts DELETE",
    permission: "news.write",
    run: () =>
      news0.DELETE(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof news0.DELETE>)
      ),
  },
  {
    name: "app/api/admin/news/route.ts POST",
    permission: "news.write",
    run: () =>
      news1.POST(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof news1.POST>)
      ),
  },
  {
    name: "app/api/admin/news/tags/[tagId]/route.ts PUT",
    permission: "news.write",
    run: () =>
      news2.PUT(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof news2.PUT>)
      ),
  },
  {
    name: "app/api/admin/news/tags/route.ts POST",
    permission: "news.write",
    run: () =>
      news3.POST(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof news3.POST>)
      ),
  },
  {
    name: "app/api/admin/courses/[id]/publish/route.ts PATCH",
    permission: "courses.write",
    run: () =>
      courses0.PATCH(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses0.PATCH>)
      ),
  },
  {
    name: "app/api/admin/courses/[id]/route.ts GET",
    permission: "courses.read",
    run: () =>
      courses1.GET(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses1.GET>)
      ),
  },
  {
    name: "app/api/admin/courses/[id]/route.ts PUT",
    permission: "courses.write",
    run: () =>
      courses1.PUT(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses1.PUT>)
      ),
  },
  {
    name: "app/api/admin/courses/[id]/route.ts DELETE",
    permission: "courses.write",
    run: () =>
      courses1.DELETE(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses1.DELETE>)
      ),
  },
  {
    name: "app/api/admin/courses/route.ts GET",
    permission: "courses.read",
    run: () =>
      courses2.GET(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses2.GET>)
      ),
  },
  {
    name: "app/api/admin/courses/route.ts POST",
    permission: "courses.write",
    run: () =>
      courses2.POST(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses2.POST>)
      ),
  },
  {
    name: "app/api/admin/courses/upload/cover/route.ts POST",
    permission: "courses.write",
    run: () =>
      courses3.POST(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses3.POST>)
      ),
  },
  {
    name: "app/api/admin/courses/upload/video/route.ts POST",
    permission: "courses.write",
    run: () =>
      courses4.POST(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses4.POST>)
      ),
  },
  {
    name: "app/api/admin/courses/upload/video-url/route.ts POST",
    permission: "courses.write",
    run: () =>
      courses5.POST(
        ...([
          undefined,
          { params: Promise.resolve({ id: "fixture", tagId: "tag" }) },
        ] as unknown as Parameters<typeof courses5.POST>)
      ),
  },
];
function session(permissions: string[]) {
  return { user: { permissions }, site: { label: "fixture" } } as Awaited<
    ReturnType<typeof getAdminSession>
  >;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected upstream call");
    })
  );
});
for (const route of routes) {
  it(`${route.name} rejects anonymous requests before touching the request or upstream`, async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
    expect((await route.run()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it(`${route.name} rejects missing or wrong-module permissions`, async () => {
    for (const grants of [
      [],
      [route.permission.startsWith("news") ? "courses.write" : "news.write"],
      ["admin.manage"],
    ]) {
      vi.mocked(getAdminSession).mockResolvedValue(session(grants));
      expect((await route.run()).status).toBe(403);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
}
it("permits a writer and rechecks revoked grants before the next write", async () => {
  const request = () =>
    new NextRequest("http://localhost/api/admin/news", { method: "POST", body: "{}" });
  vi.mocked(getAdminSession).mockResolvedValue(session(["news.write"]));
  expect((await createNews(request())).status).toBe(200);
  expect(createAdminNews).toHaveBeenCalledTimes(1);
  vi.mocked(getAdminSession).mockResolvedValue(session(["news.read"]));
  expect((await createNews(request())).status).toBe(403);
  expect(createAdminNews).toHaveBeenCalledTimes(1);
});

import pagenews0 from "@/app/(admin)/news/[id]/edit/page";

import pagenews1 from "@/app/(admin)/news/new/page";

import pagenews2 from "@/app/(admin)/news/page";

import pagecourses0 from "@/app/(admin)/courses/[id]/edit/page";

import pagecourses1 from "@/app/(admin)/courses/new/page";

import pagecourses2 from "@/app/(admin)/courses/page";

for (const page of [
  {
    name: "app/(admin)/news/[id]/edit/page.tsx",
    run: () =>
      pagenews0(
        ...([
          { params: Promise.resolve({ id: "item" }), searchParams: Promise.resolve({}) },
        ] as unknown as Parameters<typeof pagenews0>)
      ),
  },
  {
    name: "app/(admin)/news/new/page.tsx",
    run: () =>
      pagenews1(
        ...([
          { params: Promise.resolve({ id: "item" }), searchParams: Promise.resolve({}) },
        ] as unknown as Parameters<typeof pagenews1>)
      ),
  },
  {
    name: "app/(admin)/news/page.tsx",
    run: () =>
      pagenews2(
        ...([
          { params: Promise.resolve({ id: "item" }), searchParams: Promise.resolve({}) },
        ] as unknown as Parameters<typeof pagenews2>)
      ),
  },
  {
    name: "app/(admin)/courses/[id]/edit/page.tsx",
    run: () =>
      pagecourses0(
        ...([
          { params: Promise.resolve({ id: "item" }), searchParams: Promise.resolve({}) },
        ] as unknown as Parameters<typeof pagecourses0>)
      ),
  },
  {
    name: "app/(admin)/courses/new/page.tsx",
    run: () =>
      pagecourses1(
        ...([
          { params: Promise.resolve({ id: "item" }), searchParams: Promise.resolve({}) },
        ] as unknown as Parameters<typeof pagecourses1>)
      ),
  },
  {
    name: "app/(admin)/courses/page.tsx",
    run: () =>
      pagecourses2(
        ...([
          { params: Promise.resolve({ id: "item" }), searchParams: Promise.resolve({}) },
        ] as unknown as Parameters<typeof pagecourses2>)
      ),
  },
]) {
  it(`${page.name} blocks direct navigation before privileged reads or draft creation`, async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session([]));
    await expect(page.run()).rejects.toThrow("redirect:/forbidden");
    expect(fetch).not.toHaveBeenCalled();
    expect(createAdminNews).not.toHaveBeenCalled();
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/news/news-editor", () => ({ NewsEditor: () => null }));
vi.mock("@/components/admin/news/news-list-page", () => ({ NewsListPage: () => null }));
vi.mock("@/components/admin/courses/course-editor", () => ({ CourseEditor: () => null }));
vi.mock("@/components/admin/courses/courses-list-page", () => ({ CoursesListPage: () => null }));
