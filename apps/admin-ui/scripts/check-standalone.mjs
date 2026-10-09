import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const standalone = resolve(appRoot, ".next/standalone");
const isolated = await mkdtemp(join(tmpdir(), "admin-standalone-"));
const requests = [];
const fixture = createServer((request, response) => {
  requests.push(request.url);
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  if (request.url === "/admin/auth/me" && request.headers.cookie === "fd_admin_session=fixture") {
    response.end(
      JSON.stringify({
        code: 200,
        data: {
          user: {
            id: "fixture",
            email: "fixture@example.invalid",
            displayName: "Fixture Admin",
            status: "active",
            siteScope: "all",
            roleKeys: ["super_admin"],
            permissions: [],
            requireMfa: false,
            mfaEnabledAt: null,
          },
          session: { id: "fixture" },
        },
      })
    );
    return;
  }
  if (request.url?.split("?")[0] === "/content/api/admin/courses") {
    assert.equal(request.headers["x-admin-api-token"], "fixture-only");
    response.end(
      JSON.stringify({
        code: 200,
        data: {
          list: [
            {
              id: 1,
              published: true,
              localized: { "en-US": { title: "Standalone fixture course" } },
              instructors: [{ userId: 123, nickName: "Fixture instructor" }],
            },
          ],
          total: 1,
          stats: { total: 1, published: 1, unpublished: 0, instructors: 1 },
        },
      })
    );
    return;
  }
  response.writeHead(404).end(JSON.stringify({ code: 404, msg: "Unexpected fixture request" }));
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function checkSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(path);
      assert.ok(
        !relative(standalone, target).startsWith(".."),
        `Standalone symlink escapes package: ${path}`
      );
    } else if (entry.isDirectory()) {
      await checkSymlinks(path);
    }
  }
}

async function checkSite(site, origin, basePath) {
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((done) => reservation.close(done));
  let logs = "";
  // Do not inherit credentials or regional URLs. Every backend is a loopback fixture.
  const child = spawn(process.execPath, ["apps/admin-ui/server.js"], {
    cwd: isolated,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
      ADMIN_SITE: site,
      ADMIN_API_BASE_URL: `${origin}/admin`,
      ADMIN_GLOBAL_API_BASE_URL: `${origin}/admin`,
      NEWS_API_BASE_URL: `${origin}/content`,
      TEXT_GAME_API_BASE_URL: `${origin}/studio`,
      JAVA_ADMIN_API_TOKEN: "fixture-only",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const stopped = once(child, "exit");
  const url = (path) => `http://127.0.0.1:${port}${basePath}${path}`;
  const get = (path, authenticated = false) =>
    fetch(url(path), {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      ...(authenticated ? { headers: { cookie: "fd_admin_session=fixture" } } : {}),
    });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Standalone exited before ready:\n${logs}`);
      try {
        const response = await get("/login");
        if (response.status === 200) {
          ready = true;
          break;
        }
        throw new Error(`Login returned ${response.status}: ${await response.text()}\n${logs}`);
      } catch (error) {
        if (error.cause?.code !== "ECONNREFUSED") throw error;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready, `Standalone did not become ready:\n${logs}`);
    const before = requests.length;
    for (const path of ["/courses", "/ip/interactive-films", "/members/user-levels", "/news"]) {
      const response = await get(path);
      assert.equal(response.status, 307, `${site} ${path}:\n${logs}`);
      assert.match(response.headers.get("location"), /\/login$/);
    }
    for (const path of [
      "/api/admin/courses",
      "/api/admin/interactive-films/diagnostic-invalid-id",
    ]) {
      const response = await get(path);
      assert.equal(response.status, 401, `${site} ${path}:\n${logs}`);
    }
    assert.equal(requests.length, before, "Unauthenticated routes contacted a backend");
    const api = await get("/api/admin/courses", true);
    assert.equal(
      api.status,
      200,
      `${site} authenticated course API: ${await api.clone().text()}\n${logs}`
    );
    const payload = await api.json();
    assert.equal(payload.items[0].instructors[0].userId, "864871");
    const page = await get("/courses", true);
    assert.equal(page.status, 200, `${site} authenticated course page:\n${logs}`);
    assert.match(await page.text(), /Standalone fixture course/);
    assert.doesNotMatch(logs, /MODULE_NOT_FOUND|Cannot find module/);
    console.log(`Admin standalone ${site}: course page/API and protected routes ok`);
  } finally {
    child.kill("SIGTERM");
    await stopped;
  }
}

try {
  await checkSymlinks(standalone);
  await cp(standalone, isolated, { recursive: true, verbatimSymlinks: true });
  // Next can trace env files. Never let a production-shaped test load real configuration.
  for (const directory of [isolated, join(isolated, "apps/admin-ui")]) {
    for (const entry of await readdir(directory)) {
      if (entry === ".env" || entry.startsWith(".env.")) await rm(join(directory, entry));
    }
  }
  const routes = JSON.parse(
    await readFile(join(isolated, "apps/admin-ui/.next/routes-manifest.json"), "utf8")
  );
  const origin = `http://127.0.0.1:${await listen(fixture)}`;
  for (const site of ["global", "cn"]) await checkSite(site, origin, routes.basePath || "");
} finally {
  fixture.closeAllConnections();
  if (fixture.listening) await new Promise((done) => fixture.close(done));
  await rm(isolated, { recursive: true, force: true });
}
