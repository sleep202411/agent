import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAdminUserLevelDefinitions } from "./admin-user-levels";
import { approveAdminUserLevelApplication } from "./admin-user-level-applications";

vi.mock("server-only", () => ({}));

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("Java user-level admin redirects", () => {
  it.each([
    ["definitions read", 302, () => listAdminUserLevelDefinitions()],
    ["application approval", 307, () => approveAdminUserLevelApplication(42)],
  ] as const)(
    "rejects a redirected %s before forwarding credentials",
    async (_name, status, call) => {
      let destinationRequests = 0;
      let receivedDummyToken = false;
      const destination = createServer((request, response) => {
        destinationRequests += 1;
        receivedDummyToken = request.headers["x-audit-admin-token"] === "local-test-only";
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ code: 200, data: [] }));
      });
      const destinationUrl = await listen(destination);
      const origin = createServer((_request, response) => {
        response.writeHead(status, { Location: `${destinationUrl}/redirect-target` });
        response.end();
      });
      try {
        const originUrl = await listen(origin);
        vi.stubEnv("JAVA_ADMIN_API_BASE_URL", originUrl);
        vi.stubEnv("JAVA_ADMIN_API_TOKEN_HEADER", "X-Audit-Admin-Token");
        vi.stubEnv("JAVA_ADMIN_API_TOKEN", "local-test-only");
        const outcome = await call().then(
          () => "resolved",
          () => "rejected"
        );
        expect({ outcome, destinationRequests, receivedDummyToken }).toEqual({
          outcome: "rejected",
          destinationRequests: 0,
          receivedDummyToken: false,
        });
      } finally {
        await close(origin);
        await close(destination);
      }
    }
  );
});
