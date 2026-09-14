import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAdminUserLevelRelation,
  listAdminUserLevelDefinitions,
  listAdminUserLevelRelations,
  saveAdminUserLevelRelation,
} from "./admin-user-levels";

vi.mock("server-only", () => ({}));

const JAVA_URL = "https://java.example.test/content";
const API_TOKEN = "user-level-admin-token";

function envelope(
  data: unknown,
  extras: Record<string, unknown> = {},
  code = 200,
  msg = "success",
  status = 200
): Response {
  return Response.json({ code, msg, data, ...extras }, { status });
}

describe("admin user-levels Java boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEWS_API_BASE_URL", JAVA_URL);
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", API_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists relations with filters and pagination fields", async () => {
    const fetchMock = vi.fn(async () =>
      envelope(
        [
          {
            id: 1001,
            userId: 123,
            userName: "张三",
            levelId: 5,
            levelName: "FD",
            remark: "评审通过",
            createTime: "2026-07-01T10:00:00",
            updateTime: "2026-07-01T10:00:00",
          },
        ],
        { total: 128, page: 2, pageSize: 10 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAdminUserLevelRelations({ page: 2, pageSize: 10, userId: 123, levelId: 5 })
    ).resolves.toEqual({
      items: [
        {
          id: 1001,
          userId: 123,
          userName: "张三",
          levelId: 5,
          levelName: "FD",
          remark: "评审通过",
          createTime: "2026-07-01T10:00:00",
          updateTime: "2026-07-01T10:00:00",
        },
      ],
      total: 128,
      page: 2,
      pageSize: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/user-levels?page=2&pageSize=10&userId=123&levelId=5`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Admin-Api-Token": API_TOKEN }),
      })
    );
  });

  it("lists level definitions", async () => {
    const fetchMock = vi.fn(async () =>
      envelope([
        {
          id: 1,
          name: "FD-I · 附属创作者",
          description: "核心能力",
          imagePath: "static/icon/a.png",
          type: 1,
          remark: null,
          createTime: "2026-03-23T23:31:35",
          updateTime: "2026-05-26T09:45:20",
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAdminUserLevelDefinitions()).resolves.toEqual([
      {
        id: 1,
        name: "FD-I · 附属创作者",
        description: "核心能力",
        imagePath: "static/icon/a.png",
        type: 1,
        remark: null,
        createTime: "2026-03-23T23:31:35",
        updateTime: "2026-05-26T09:45:20",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/user-levels/levels`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Admin-Api-Token": API_TOKEN }),
      })
    );
  });

  it("posts create and edit payloads", async () => {
    const fetchMock = vi.fn(async () => envelope(null));
    vi.stubGlobal("fetch", fetchMock);

    await saveAdminUserLevelRelation({ userId: 123, levelId: 5, remark: "评审通过" });
    await saveAdminUserLevelRelation({ id: 1001, levelId: 6, remark: "升级" });

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const secondCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(firstCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ levelId: 5, userId: 123, remark: "评审通过" }),
    });
    expect(secondCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ levelId: 6, id: 1001, remark: "升级" }),
    });
  });

  it("deletes by relation id query", async () => {
    const fetchMock = vi.fn(async () => envelope(null));
    vi.stubGlobal("fetch", fetchMock);

    await deleteAdminUserLevelRelation(1001);

    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/user-levels?id=1001`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("surfaces Java business message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: 500, msg: "failed", message: "用户等级关联不存在" }, { status: 200 })
      )
    );

    await expect(deleteAdminUserLevelRelation(999)).rejects.toThrow("用户等级关联不存在");
  });
});
