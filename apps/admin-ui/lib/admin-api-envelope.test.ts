import { expect, it } from "vitest";
import { parseAdminEnvelope } from "./admin-api";

const json = (body: unknown, status = 200) => Response.json(body, { status });

it("returns data for a code 200 envelope", async () => {
  await expect(parseAdminEnvelope(json({ code: 200, data: { id: "one" } }))).resolves.toEqual({
    id: "one",
  });
});

it("prefers msg and rejects code failures inside HTTP 200", async () => {
  await expect(
    parseAdminEnvelope(json({ code: 404, msg: "播放分发（HLS）仅在中国站启用。", message: "x" }))
  ).rejects.toThrow(/^播放分发（HLS）仅在中国站启用。$/);
});

it("appends every Zod issue to a validation message, naming root issues", async () => {
  const response = json(
    {
      message: "Validation failed",
      issues: [
        {
          path: "gameIds",
          message: "Too big: expected array to have <=100 items",
          code: "too_big",
        },
        { path: "", message: 'Unrecognized key: "extra"', code: "unrecognized_keys" },
      ],
    },
    400
  );
  await expect(parseAdminEnvelope(response)).rejects.toThrow(
    'Validation failed（gameIds: Too big: expected array to have <=100 items；(root): Unrecognized key: "extra"）'
  );
});

it("keeps a bare message when there are no issues", async () => {
  await expect(
    parseAdminEnvelope(json({ message: "Validation failed", issues: [] }, 400))
  ).rejects.toThrow(/^Validation failed$/);
  await expect(parseAdminEnvelope(json({ message: "Forbidden resource" }, 403))).rejects.toThrow(
    /^Forbidden resource$/
  );
});

it("falls back to the HTTP status when the body is not an envelope", async () => {
  await expect(parseAdminEnvelope(new Response("<html>", { status: 502 }))).rejects.toThrow(
    "后台服务请求失败：502"
  );
});
