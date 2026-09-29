import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveAdminUserLevelApplication,
  getAdminUserLevelApplication,
  listAdminUserLevelApplications,
  rejectAdminUserLevelApplication,
} from "./admin-user-level-applications";

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

const SAMPLE = {
  id: 42,
  userId: 123,
  userName: "张三",
  levelId: 5,
  levelName: "FD",
  crewName: "某某剧组",
  crewLink: "https://example.com/crews/1",
  ipName: "某某IP",
  ipLink: "https://example.com/ip/100",
  attachmentUrl: "user/level-apply/123/a.pdf",
  extraInfo: "补充",
  status: 0,
  adminRemark: null,
  createTime: "2026-09-10T10:00:00",
  updateTime: "2026-09-10T10:00:00",
};

describe("admin user-level-applications Java boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEWS_API_BASE_URL", JAVA_URL);
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", API_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists applications with filters and pagination", async () => {
    const fetchMock = vi.fn(async () => envelope([SAMPLE], { total: 3, page: 1, pageSize: 20 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAdminUserLevelApplications({ page: 1, pageSize: 20, status: 0, userId: 123, levelId: 5 })
    ).resolves.toEqual({
      items: [SAMPLE],
      total: 3,
      page: 1,
      pageSize: 20,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/user-level-applications?page=1&pageSize=20&status=0&userId=123&levelId=5`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Admin-Api-Token": API_TOKEN }),
      })
    );
  });

  it.each(["", null, undefined])(
    "keeps applications with absent Crew/IP associations (%s)",
    async (empty) => {
      const raw = { ...SAMPLE, crewName: empty, crewLink: empty, ipName: empty, ipLink: empty };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope([raw], { total: 1, page: 1, pageSize: 20 }))
      );
      const result = await listAdminUserLevelApplications({ page: 1, pageSize: 20 });
      expect(result.items).toEqual([
        { ...SAMPLE, crewName: "", crewLink: "", ipName: "", ipLink: "" },
      ]);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(raw))
      );
      await expect(getAdminUserLevelApplication(42)).resolves.toEqual(result.items[0]);
    }
  );

  it("loads application detail", async () => {
    const fetchMock = vi.fn(async () => envelope(SAMPLE));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminUserLevelApplication(42)).resolves.toEqual(SAMPLE);
    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/user-level-applications/42`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Admin-Api-Token": API_TOKEN }),
      })
    );
  });

  it("approves and rejects with optional adminRemark", async () => {
    const fetchMock = vi.fn(async () => envelope(null));
    vi.stubGlobal("fetch", fetchMock);

    await approveAdminUserLevelApplication(42, "材料齐全");
    await rejectAdminUserLevelApplication(42, "材料不足");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${JAVA_URL}/api/admin/user-level-applications/42/approve`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ adminRemark: "材料齐全" }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${JAVA_URL}/api/admin/user-level-applications/42/reject`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ adminRemark: "材料不足" }),
      })
    );
  });
});
